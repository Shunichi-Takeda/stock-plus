/**
 * Stock Plus - 機能: 返答済みメッセージトラッキング
 *
 * やること:
 *  1. メッセージ（チャット）で「送信」操作を検知し、宛先（トーク相手・グループ名）を
 *     localStorageに記録する（保存期間: 30日。期限切れは自動削除）。
 *  2. メッセージ一覧（チャットグループモーダル）の項目に「✓返答済み」バッジを付ける。
 *  3. 一覧のタブ行（すべて／ノートに紐づく／ノートに紐づかない）の右に
 *     太字の「返信済み」リンクを追加し、クリックで一覧を
 *     「自分が返信したことのあるメッセージ」だけに絞り込む。
 *
 * セレクタは実際のStock（stock-app.jp）のDOM（2026-08確認）に合わせてある。
 * Stock側のDOM変更時は SELECTORS だけ直せば追従できる。
 */
(function () {
  "use strict";

  // ---- チューニングポイント: Stock側のDOMに合わせて調整する場所 ----------
  const SELECTORS = {
    // メッセージ一覧の1項目
    listItem: "li.chatGroupListItem",
    // 一覧項目内の宛先名。ノート紐づきの項目は __groupName（フォルダパス）と
    // __wrappedName（ノート名）の両方を持ち、チャット側の宛先名に対応するのは
    // __wrappedName なので、必ずこちらを優先する
    listItemName: ".chatGroupListItem__wrappedName",
    listItemNameFallback: ".chatGroupListItem__groupName",
    // 一覧モーダルのタブ行（すべて／ノートに紐づく／ノートに紐づかない）
    tabBox: ".chatGroupsModal__tabBox",
    // Stock標準のタブ
    stockTab: ".chatGroupsModal__tabBox__tab",
    // 開いているチャットウィンドウ
    chatroom: ".chatroom",
    // チャットウィンドウ内の宛先名（--forDirect等のmodifier差異を吸収）
    chatroomName: "[class*='chatroom__nameBox__name']",
    // 1対1のダイレクトチャットは __name 要素が無く、相手名は memberNames に入る
    chatroomNameFallback: ".chatroom__nameBox__memberNames",
    // 送信ボタン
    sendButton: ".chatroom__toolBar__sendBtn",
    // 各メッセージの操作ボックス（「了解しました」ボタンが入っている。ボタン自体はクラス無し）
    ackButtonBox: ".chatListItemToolBox",
    // 「了解しました」ボタンのラベル（完全一致）
    ackButtonText: "了解しました",
    // メッセージ入力欄（チャットウィンドウ内のtextarea全般）
    composer: ".chatroom textarea",
  };
  // ----------------------------------------------------------------------

  const BADGE_CLASS = "stock-plus-replied-badge";
  const TAB_CLASS = "stock-plus-replied-tab";
  const HIDDEN_CLASS = "stock-plus-hidden";

  const store = new window.StockPlus.TtlStore("repliedMessages"); // TTL 30日
  let filterActive = false;

  // 名前ゆらぎを吸収する照合キー（core/util.js）
  const matchKey = window.StockPlus.matchKey;

  /** 記録済みエントリのMap（照合キー → エントリ） */
  function repliedEntryMap() {
    const map = new Map();
    for (const e of store.load()) {
      map.set(matchKey(e.recipient), e);
    }
    return map;
  }

  /** 一覧項目の宛先名の照合キー（自前バッジのテキストは除外） */
  function nameOfItem(item) {
    const el =
      item.querySelector(SELECTORS.listItemName) ||
      item.querySelector(SELECTORS.listItemNameFallback);
    if (!el) return "";
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 1 && node.classList.contains(BADGE_CLASS)) continue;
      text += node.textContent;
    }
    return matchKey(text);
  }

  // ---- 返答（送信）操作の検知 -------------------------------------------

  /** チャットウィンドウ内の要素から宛先名を取得する */
  function recipientOfChatroom(el) {
    const room = el.closest(SELECTORS.chatroom);
    if (!room) return null;
    const nameEl =
      room.querySelector(SELECTORS.chatroomName) ||
      room.querySelector(SELECTORS.chatroomNameFallback);
    const text = nameEl && nameEl.textContent && nameEl.textContent.trim();
    return text || null;
  }

  /** 返答を1件記録する（同一スレッドへの再返答は時刻更新扱い） */
  function recordReply(recipient) {
    if (!recipient) return;
    store.upsert({ key: matchKey(recipient), recipient: recipient }, "key");
    console.info("[Stock Plus] 返答を記録:", recipient);
    scheduleRefresh();
  }

  /**
   * 送信操作の後、入力欄が空になったことを確認してから記録する。
   * Enter送信/Cmd+Enter送信/ボタン送信のどの設定でも動き、
   * 「Enterが改行扱いの環境」での誤記録も防げる。
   */
  function armSendCheck(el) {
    const room = el.closest(SELECTORS.chatroom);
    if (!room) return;
    const composer = room.querySelector("textarea");
    if (!composer) return;
    const before = (composer.value || "").trim();
    if (!before) return;
    setTimeout(() => {
      if (!(composer.value || "").trim()) {
        recordReply(recipientOfChatroom(composer));
      }
    }, 400);
  }

  function initReplyDetection() {
    // 送信ボタン / 「了解しました」ボタンのクリック
    document.addEventListener(
      "click",
      (ev) => {
        if (!window.StockPlus.isCurrentInstance()) return;
        if (!(ev.target instanceof Element)) return;

        const sendBtn = ev.target.closest(SELECTORS.sendButton);
        if (sendBtn) {
          armSendCheck(sendBtn);
          return;
        }

        const ackBtn = ev.target.closest(SELECTORS.ackButtonBox + " button");
        if (ackBtn && (ackBtn.textContent || "").trim() === SELECTORS.ackButtonText) {
          recordReply(recipientOfChatroom(ackBtn));
        }
      },
      true
    );

    // キーボードによる送信（Enter / Cmd+Enter / Ctrl+Enter。Shift+Enterは改行）
    document.addEventListener(
      "keydown",
      (ev) => {
        if (!window.StockPlus.isCurrentInstance()) return;
        if (ev.key !== "Enter" || ev.shiftKey || ev.isComposing) return;
        const target = ev.target;
        if (!(target instanceof Element) || !target.matches(SELECTORS.composer)) return;
        armSendCheck(target);
      },
      true
    );
  }

  // ---- 「返信済み」フィルタタブ ------------------------------------------

  function ensureFilterTab() {
    const box = document.querySelector(SELECTORS.tabBox);
    if (!box) return;

    // 別インスタンス（オーファン化した旧content script）が作ったタブは
    // クリックハンドラが死んでいるため、作り直す
    const existing = box.querySelector("." + TAB_CLASS);
    if (existing) {
      if (existing.dataset.stockPlusInstance === window.StockPlus.instanceId) {
        return;
      }
      existing.remove();
    }

    const tab = document.createElement("a");
    tab.dataset.stockPlusInstance = window.StockPlus.instanceId;
    tab.className =
      SELECTORS.stockTab.replace(/^\./, "").replace(/\./g, " ") + " " + TAB_CLASS;
    tab.textContent = "返信済み";
    tab.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setFilter(!filterActive);
    });
    box.appendChild(tab);
    updateTabState();
  }

  function setFilter(on) {
    filterActive = on;
    updateTabState();
    applyFilter();
  }

  function updateTabState() {
    const tab = document.querySelector("." + TAB_CLASS);
    if (!tab) return;
    tab.classList.toggle("active", filterActive);
    const count = repliedEntryMap().size;
    tab.textContent = count > 0 ? `返信済み(${count})` : "返信済み";
  }

  /** フィルタON時、返信したことのある宛先以外の項目を隠す */
  function applyFilter() {
    const entryMap = repliedEntryMap();
    const matched = new Set();
    for (const item of document.querySelectorAll(SELECTORS.listItem)) {
      const key = nameOfItem(item);
      const replied = entryMap.has(key);
      if (replied) matched.add(key);
      item.classList.toggle(HIDDEN_CLASS, filterActive && !replied);
    }
    const unmatched = filterActive
      ? Array.from(entryMap.entries())
          .filter(([key]) => !matched.has(key))
          .map(([, e]) => e)
          .sort((a, b) => b.savedAt - a.savedAt)
      : [];
    updateFilterNote(unmatched);
  }

  function formatDate(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  /** モーダルの検索欄に宛先名を入れてタイトル検索する */
  async function searchInModal(recipient) {
    const findInput = () =>
      document.querySelector(".chatGroupsModal__header__searchInputCell input");
    let input = findInput();
    if (!input) return;

    // 検索結果が自前フィルタで隠れないよう解除しておく
    setFilter(false);

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;

    // 前回の検索テキストが残っていると「同じ値の再入力」が変更なし扱いになり
    // Enterで検索されず「すべて」一覧に戻ってしまうため、必ず一度空にしてから入れ直す
    setter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(300);

    // 改名されやすい【状態】プレフィックスを除いた先頭部分で検索する
    const query = recipient.replace(/【[^】]*】/g, "").trim().slice(0, 15);
    input = findInput();
    if (!input) return;
    input.focus();
    setter.call(input, query);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Stockの検索はinputイベントでは発火せず、Enter（またはsubmit）が必要
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
    input.dispatchEvent(
      new KeyboardEvent("keyup", { key: "Enter", bubbles: true })
    );
    const form = input.closest("form");
    if (form) {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }

    // 検索結果の「タイトル」タブが出現したら選択する（最大5秒ポーリング）
    for (let i = 0; i < 25; i++) {
      await sleep(200);
      const titleTab = Array.from(
        document.querySelectorAll(".chatGroupsModal__searchTabBox__tab")
      ).find((el) => (el.textContent || "").trim().startsWith("タイトル"));
      if (titleTab) {
        if (!titleTab.classList.contains("active")) titleTab.click();
        return;
      }
    }
  }

  /**
   * 一覧は直近分しか読み込まれないため、返信済みでも一覧に無いスレッドがある。
   * それらをフィルタON時に一覧末尾へ表示する（クリックでタイトル検索）。
   */
  function updateFilterNote(unmatchedEntries) {
    const NOTE_CLASS = "stock-plus-filter-note";
    let note = document.querySelector("." + NOTE_CLASS);
    if (!unmatchedEntries || unmatchedEntries.length === 0) {
      if (note) note.remove();
      return;
    }
    const list = document.querySelector(SELECTORS.listItem)?.parentElement;
    if (!list) return;
    if (!note) {
      note = document.createElement("div");
      note.className = NOTE_CLASS;
      list.insertAdjacentElement("afterend", note);
    }
    note.textContent = "";
    const head = document.createElement("p");
    head.className = "stock-plus-filter-note-head";
    head.textContent = `この他に返信済み ${unmatchedEntries.length}件（一覧に未読み込み。クリックで検索）:`;
    note.appendChild(head);
    for (const e of unmatchedEntries) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "stock-plus-filter-note-row";
      row.textContent = `${formatDate(e.savedAt)}　${e.recipient}`;
      row.addEventListener("click", () => searchInModal(e.recipient));
      note.appendChild(row);
    }
  }

  function initFilterTab() {
    // Stock標準タブをクリックしたら自前フィルタは解除する
    document.addEventListener(
      "click",
      (ev) => {
        if (!window.StockPlus.isCurrentInstance()) return;
        if (!(ev.target instanceof Element)) return;
        const stockTab = ev.target.closest(SELECTORS.stockTab);
        if (stockTab && !stockTab.classList.contains(TAB_CLASS) && filterActive) {
          setFilter(false);
        }
      },
      true
    );
  }

  // ---- 一覧への「✓返答済み」バッジ付与 ----------------------------------

  function refreshBadges() {
    const items = document.querySelectorAll(SELECTORS.listItem);
    if (items.length === 0) return;
    const entryMap = repliedEntryMap();

    for (const item of items) {
      const nameEl =
        item.querySelector(SELECTORS.listItemName) ||
        item.querySelector(SELECTORS.listItemNameFallback);
      if (!nameEl) continue;
      const existing = item.querySelector("." + BADGE_CLASS);
      const replied = entryMap.has(nameOfItem(item));
      if (replied && !existing) {
        const badge = document.createElement("span");
        badge.className = BADGE_CLASS;
        badge.title = "返答済み（Stock Plus）";
        badge.textContent = "✓ 返答済み";
        nameEl.appendChild(badge);
      } else if (!replied && existing) {
        existing.remove();
      }
    }
  }

  // ---- DOM変化への追従 ---------------------------------------------------

  let refreshTimer = null;

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (!window.StockPlus.isCurrentInstance()) return;
      ensureFilterTab();
      refreshBadges();
      updateTabState();
      applyFilter();
    }, 300);
  }

  function initObserver() {
    const observer = new MutationObserver(() => scheduleRefresh());
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleRefresh();
  }

  // ---- 機能登録 ----------------------------------------------------------

  window.StockPlus.registerFeature({
    id: "replied-messages",
    name: "返答済みメッセージトラッキング",
    init() {
      initReplyDetection();
      initFilterTab();
      initObserver();
    },
  });
})();
