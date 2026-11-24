/**
 * Stock Plus - 機能: 「ノートだけ既読」（ページ側）
 *
 * メッセージ一覧で、ノートに紐づくメッセージに未読があるときだけ（どのタブを選んでいても）、
 * ヘッダーの「すべて既読」の左に「ノートだけ既読」を出す。
 * 押すと、ノートに紐づくメッセージ（チャットグループ）の未読だけを既読にする。
 * Stock標準の「すべて既読」はタブに関係なく全件を既読にするため、その補完。
 *
 * 画面がやっていることをそのままなぞる:
 *  - 対象は Stock（React/Redux）が持っている未読データ unreadsData.unreads のうち
 *    unreadableType === "Chat" かつ contentsType === "stock" かつ今のチームの companyId のもの。
 *    chatGroupId ごとにまとめる（タブの「ノートに紐づく(N)」と同じ数え方）
 *  - 1件ごとに、Stockがチャットを開いたときと同じく
 *    「UNREADS/DELETE_CHAT_UNREADS を dispatch → DELETE /chat_groups/{id}/unreads.json」を行う
 *  - 認証ヘッダーは画面と同じ（localStorage の uid / client / accessToken / expiry / tokenType）。
 *    WAFのチャレンジが有効なときは画面と同じく AwsWafIntegration.getToken() の値を付ける。
 *    拡張側で保存・外部送信はしない
 *  - 同時には投げず、1件ずつ間隔をあけて呼ぶ。失敗したらそこで止める
 *
 * このファイルはページ側（manifest の world: "MAIN"）で動く。Stock の内部データ（Redux store）と
 * AwsWafIntegration を読む必要があり、通常の content script（isolated world）からは読めないため。
 * ON/OFF は markNoteRead.js（isolated world）が <html> の属性で渡す:
 *   data-stock-plus-note-read="on|off"
 */
(() => {
  "use strict";

  // インスタンスガード: 拡張を再読み込みすると古いスクリプトがページに残るため、最新のものだけ動かす
  const ROOT = document.documentElement;
  const INSTANCE_ID = Date.now() + "-" + Math.random().toString(36).slice(2);
  ROOT.setAttribute("data-stock-plus-nr-instance", INSTANCE_ID);
  const isCurrent = () => ROOT.getAttribute("data-stock-plus-nr-instance") === INSTANCE_ID;
  const isEnabled = () => isCurrent() && ROOT.getAttribute("data-stock-plus-note-read") === "on";

  // ---- チューニングポイント: Stock側に合わせて調整する場所 ----------------
  const API_BASE = "https://api.stock-app.jp/api/v2";
  const SELECTORS = {
    modal: ".chatGroupsModal",
    tabBox: ".chatGroupsModal__tabBox",
    header: ".chatGroupsModal__header",
    markReadLnk: ".chatGroupsModal__header__markReadLnk",
    newChatGroupLnk: ".chatGroupsModal__header__newChatGroupLnk",
    // 検索中はヘッダーの右側がこの「キャンセル」だけになる
    cancelLnk: ".chatGroupsModal__header__cancelLnk",
  };
  const UNREADABLE_CHAT = "Chat";
  const CONTENTS_STOCK = "stock";
  const ACTION_DELETE_CHAT_UNREADS = "UNREADS/DELETE_CHAT_UNREADS";
  const INTERVAL_MS = 200;
  // ----------------------------------------------------------------------

  // keepChatGroupsOpen: Stockが「このクラスの中のクリックでは一覧を閉じない」と扱うクラス
  const LINK_CLASS = "stock-plus-note-read-lnk keepChatGroupsOpen";
  let running = false;

  // ---------- Stock の内部データ ----------
  let cachedStore = null;

  function findStore() {
    if (cachedStore) return cachedStore;
    // React が描いた要素を1つ見つけ、親をたどって <Provider store> を探す
    const start = document.querySelector(SELECTORS.modal);
    const candidates = start ? [start] : document.querySelectorAll("body *");
    for (const el of candidates) {
      const fk = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
      if (!fk) continue;
      let f = el[fk];
      for (let i = 0; i < 80 && f; i++, f = f.return) {
        const p = f.memoizedProps;
        if (p && p.store && typeof p.store.getState === "function" && typeof p.store.dispatch === "function") {
          cachedStore = p.store;
          return cachedStore;
        }
      }
      return null; // React の要素から上にたどって無ければ、他の要素でも見つからない
    }
    return null;
  }

  /** 今のチームの「ノートに紐づく」未読の chatGroupId 一覧（重複なし） */
  function noteUnreadGroupIds() {
    const store = findStore();
    if (!store) return null;
    const state = store.getState();
    const companyId = state && state.companiesData && state.companiesData.company && state.companiesData.company.id;
    const unreads = state && state.unreadsData && state.unreadsData.unreads;
    if (!companyId || !Array.isArray(unreads)) return null;
    const ids = new Set();
    for (const u of unreads) {
      if (u.unreadableType === UNREADABLE_CHAT && u.contentsType === CONTENTS_STOCK && u.companyId === companyId) {
        ids.add(u.chatGroupId);
      }
    }
    return [...ids];
  }

  // ---------- API（画面と同じヘッダー） ----------
  async function authHeaders() {
    const get = (k) => localStorage.getItem(k);
    const client = get("client");
    const uid = get("uid");
    const accessToken = get("accessToken");
    const expiry = get("expiry");
    const tokenType = get("tokenType");
    if (!client || !uid || !accessToken || !expiry || !tokenType) return null;
    const headers = {
      uid,
      client,
      "access-token": accessToken,
      "token-type": tokenType,
      expiry: String(Number(expiry)),
    };
    try {
      const waf = window.AwsWafIntegration;
      if (waf && typeof waf.getToken === "function") {
        const token = await waf.getToken();
        if (token) {
          headers["Stock-Waf"] = "waf-challenge-enabled";
          headers["x-aws-waf-token"] = token;
        }
      }
    } catch (e) {
      // 取れなければ付けずに送る（画面と同じ）
    }
    return headers;
  }

  async function markChatGroupRead(chatGroupId, headers) {
    const res = await fetch(`${API_BASE}/chat_groups/${encodeURIComponent(chatGroupId)}/unreads.json`, {
      method: "DELETE",
      headers,
    });
    // 202 は AWS WAF のチャレンジで弾かれたとき（Stock の画面も失敗扱いにしている）
    if (!res.ok || res.status === 202) throw new Error(`HTTP ${res.status}`);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function run(link) {
    if (running) return;
    const ids = noteUnreadGroupIds();
    if (!ids) {
      alert("Stock Plus: 未読の情報を読み取れませんでした。ページを再読み込みしてからお試しください。");
      return;
    }
    if (ids.length === 0) {
      render();
      return;
    }
    if (!confirm(`ノートに紐づくメッセージ ${ids.length}件を既読にします。よろしいですか？`)) return;

    const headers = await authHeaders();
    if (!headers) {
      alert("Stock Plus: ログイン情報を読み取れませんでした。ページを再読み込みしてからお試しください。");
      return;
    }

    running = true;
    const store = findStore();
    let done = 0;
    try {
      for (const id of ids) {
        link.textContent = `既読にしています… ${done}/${ids.length}`;
        await markChatGroupRead(id, headers);
        // 成功してから画面側の未読を消す（失敗した分は未読のまま残す）
        store.dispatch({ type: ACTION_DELETE_CHAT_UNREADS, payload: { chatGroupId: id } });
        done++;
        if (done < ids.length) await sleep(INTERVAL_MS);
      }
    } catch (e) {
      console.error("[Stock Plus] note-read failed", e);
      alert(
        `Stock Plus: ${ids.length}件中 ${done}件まで既読にしたところで止まりました（${e.message}）。\n` +
          "残りは未読のままです。時間をおいて再度お試しください。"
      );
    } finally {
      running = false;
      render();
    }
  }

  // ---------- 表示 ----------
  function render() {
    const existing = document.querySelector(".stock-plus-note-read-lnk");
    const header = document.querySelector(SELECTORS.header);
    // 一覧が開いていて、検索中（ヘッダーが「キャンセル」に変わっている間）でなく、
    // ノートに紐づく未読が1件以上あるときだけ出す（Stock標準の「すべて既読」が未読0件で消えるのと同じ）
    const show =
      isEnabled() &&
      !!header &&
      !!document.querySelector(SELECTORS.tabBox) &&
      !header.querySelector(SELECTORS.cancelLnk) &&
      (running || (noteUnreadGroupIds() || []).length > 0);
    if (!show) {
      if (existing && !running) existing.remove();
      return;
    }
    let link = existing;
    if (link && link.dataset.instance !== INSTANCE_ID) {
      link.remove();
      link = null;
    }
    if (!link) {
      link = document.createElement("a");
      link.className = LINK_CLASS;
      link.dataset.instance = INSTANCE_ID;
      link.title = "「ノートに紐づく」メッセージの未読だけを既読にします（Stock Plus）";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        run(link);
      });
      const anchor = header.querySelector(SELECTORS.markReadLnk) || header.querySelector(SELECTORS.newChatGroupLnk);
      if (anchor) anchor.insertAdjacentElement("beforebegin", link);
      else header.appendChild(link);
    }
    if (running) return; // 実行中は進み具合の表示を残す
    const label = "ノートだけ既読";
    if (link.textContent !== label) link.textContent = label;
  }

  let scheduled = false;
  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (!isCurrent()) return;
      subscribeStore();
      render();
    });
  }

  // 一覧の開閉・タブの切り替えは DOM の変化で拾う。
  // 一覧を開いたまま未読が増減したとき（タブの件数の文字だけが変わる）は characterData で拾い、
  // 念のため Stock の内部データの変化も購読する
  new MutationObserver(scheduleRender).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  let subscribed = false;
  function subscribeStore() {
    if (subscribed) return;
    const store = findStore();
    if (!store || typeof store.subscribe !== "function") return;
    subscribed = true;
    let last = null;
    store.subscribe(() => {
      const s = store.getState();
      const unreads = s && s.unreadsData && s.unreadsData.unreads;
      if (unreads === last) return;
      last = unreads;
      scheduleRender();
    });
  }
  new MutationObserver(scheduleRender).observe(ROOT, {
    attributes: true,
    attributeFilter: ["data-stock-plus-note-read"],
  });
  scheduleRender();
})();
