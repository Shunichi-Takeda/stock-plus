/**
 * Stock Plus - 機能: メッセージトラッキング（返信済み / @me）
 *
 * メッセージ一覧のタブ行（すべて／ノートに紐づく／ノートに紐づかない）の右に
 * 以下のフィルタリンクを追加する:
 *
 *  - 「返信済み」: 送信操作（送信ボタン / Enter / Cmd+Enter / Ctrl+Enter）と
 *    「了解しました」ボタンを検知し、自分が返信したスレッドを記録する。
 *  - 「@me」: 自分宛メンション（span.mentionToMe）を含むスレッドを
 *    開いただけで記録する。
 *
 * 共通挙動:
 *  - クリックで一覧を該当スレッドだけに絞り込み（再クリック or Stock標準タブで解除）
 *  - 一覧の宛先名に色付きバッジを表示
 *  - 一覧に未読み込みの記録はフィルタON時に末尾へ表示（クリックでタイトル検索）
 *  - 記録はlocalStorageにチーム別で保存され、30日で自動削除
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
    // 自分宛メンション（他人宛は span.mention）
    mentionToMe: ".mentionToMe",
  };
  // ----------------------------------------------------------------------

  const BADGE_BASE_CLASS = "stock-plus-badge";
  const HIDDEN_CLASS = "stock-plus-hidden";
  const NOTE_CLASS = "stock-plus-filter-note";
  const TAB_BASE_CLASS = "stock-plus-filter-tab";

  /** トラッカー定義（フィルタタブ1つにつき1定義） */
  const TRACKERS = [
    {
      id: "replied",
      label: "返信済み",
      store: new window.StockPlus.TtlStore("repliedMessages"), // TTL 30日
      badgeText: "✓ 返答済み",
      badgeClass: "stock-plus-replied-badge",
      tabClass: "stock-plus-replied-tab",
    },
    {
      id: "mentioned",
      label: "@me",
      store: new window.StockPlus.TtlStore("mentionedMessages"), // TTL 30日
      badgeText: "@me",
      badgeClass: "stock-plus-mentioned-badge",
      tabClass: "stock-plus-mentioned-tab",
    },
  ];

  // 名前ゆらぎを吸収する照合キー（core/util.js）
  const matchKey = window.StockPlus.matchKey;

  // 現在有効なフィルタ（トラッカーid or null）
  let activeTrackerId = null;

  function activeTracker() {
    return TRACKERS.find((t) => t.id === activeTrackerId) || null;
  }

  /** 現在表示しているチームのID（URLの /teams/{id}/ 部分） */
  function currentTeam() {
    const m = location.pathname.match(/\/teams\/([^/]+)/);
    return m ? m[1] : "";
  }

  /**
   * トラッカーの記録済みエントリのMap（照合キー → エントリ）。
   * 現在のチームの記録だけを対象にする。チーム情報を持たない古い記録
   * （後方互換）は、どのチームかを判定できるまで全チームで表示する
   * （migrateLegacyEntriesが一覧との照合により順次チームを刻印する）。
   */
  function entryMapOf(tracker) {
    const team = currentTeam();
    const map = new Map();
    for (const e of tracker.store.load()) {
      if (e.team && e.team !== team) continue;
      map.set(matchKey(e.recipient), e);
    }
    return map;
  }

  /**
   * 後方互換マイグレーション: チーム情報の無い既存記録について、
   * 現在のチームのメッセージ一覧に該当スレッドが見つかったら
   * このチームの記録として刻印する。
   */
  function migrateLegacyEntries() {
    const team = currentTeam();
    if (!team) return;

    let keysInList = null; // 必要になったときだけ収集する
    for (const tracker of TRACKERS) {
      const entries = tracker.store.load();
      const legacy = entries.filter((e) => !e.team);
      if (legacy.length === 0) continue;

      if (!keysInList) {
        keysInList = new Set();
        for (const item of document.querySelectorAll(SELECTORS.listItem)) {
          keysInList.add(nameOfItem(item));
        }
      }
      let changed = false;
      for (const e of legacy) {
        if (keysInList.has(matchKey(e.recipient))) {
          e.team = team;
          changed = true;
        }
      }
      if (changed) tracker.store.replaceAll(entries);
    }
  }

  /** 一覧項目の宛先名の照合キー（自前バッジのテキストは除外） */
  function nameOfItem(item) {
    const el =
      item.querySelector(SELECTORS.listItemName) ||
      item.querySelector(SELECTORS.listItemNameFallback);
    if (!el) return "";
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 1 && node.classList.contains(BADGE_BASE_CLASS)) continue;
      text += node.textContent;
    }
    return matchKey(text);
  }

  // ---- 記録 ---------------------------------------------------------------

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

  /** トラッカーに1件記録する（同一スレッドの再記録は時刻更新扱い） */
  function record(tracker, recipient) {
    if (!recipient) return;
    const team = currentTeam();
    tracker.store.upsert(
      { key: team + "::" + matchKey(recipient), recipient: recipient, team: team },
      "key"
    );
    console.info(`[Stock Plus] ${tracker.label} に記録:`, recipient);
    scheduleRefresh();
  }

  // ---- 「返信済み」の検知 ---------------------------------------------------

  const repliedTracker = TRACKERS[0];

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
        record(repliedTracker, recipientOfChatroom(composer));
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
          record(repliedTracker, recipientOfChatroom(ackBtn));
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

  // ---- 「@me」の検知（自分宛メンションのあるスレッドを開いたら記録） --------

  const mentionedTracker = TRACKERS[1];
  // 同一ページ内で同じスレッドを繰り返し記録し続けない（localStorage連打防止）
  const mentionRecordedInSession = new Set();

  function detectMentionsInOpenChatrooms() {
    for (const room of document.querySelectorAll(SELECTORS.chatroom)) {
      if (!room.querySelector(SELECTORS.mentionToMe)) continue;
      const recipient = recipientOfChatroom(room);
      if (!recipient) continue;
      const sessionKey = currentTeam() + "::" + matchKey(recipient);
      if (mentionRecordedInSession.has(sessionKey)) continue;
      mentionRecordedInSession.add(sessionKey);
      record(mentionedTracker, recipient);
    }
  }

  // ---- フィルタタブ ---------------------------------------------------------

  function ensureFilterTabs() {
    const box = document.querySelector(SELECTORS.tabBox);
    if (!box) return;

    for (const tracker of TRACKERS) {
      // 別インスタンス（オーファン化した旧content script）が作ったタブは
      // クリックハンドラが死んでいるため、作り直す
      const existing = box.querySelector("." + tracker.tabClass);
      if (existing) {
        if (existing.dataset.stockPlusInstance === window.StockPlus.instanceId) {
          continue;
        }
        existing.remove();
      }

      const tab = document.createElement("a");
      tab.dataset.stockPlusInstance = window.StockPlus.instanceId;
      tab.className =
        SELECTORS.stockTab.replace(/^\./, "").replace(/\./g, " ") +
        " " +
        TAB_BASE_CLASS +
        " " +
        tracker.tabClass;
      tab.textContent = tracker.label;
      tab.title = `${tracker.label}で絞り込み（Stock Plus）`;
      tab.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        setFilter(activeTrackerId === tracker.id ? null : tracker.id);
      });
      box.appendChild(tab);
    }
    updateTabStates();
  }

  function setFilter(trackerId) {
    activeTrackerId = trackerId;
    updateTabStates();
    applyFilter();
  }

  function updateTabStates() {
    for (const tracker of TRACKERS) {
      const tab = document.querySelector("." + tracker.tabClass);
      if (!tab) continue;
      tab.classList.toggle("active", activeTrackerId === tracker.id);
      const count = entryMapOf(tracker).size;
      tab.textContent =
        count > 0 ? `${tracker.label}(${count})` : tracker.label;
    }
  }

  function initFilterTabs() {
    // Stock標準タブをクリックしたら自前フィルタは解除する
    document.addEventListener(
      "click",
      (ev) => {
        if (!window.StockPlus.isCurrentInstance()) return;
        if (!(ev.target instanceof Element)) return;
        const stockTab = ev.target.closest(SELECTORS.stockTab);
        if (
          stockTab &&
          !stockTab.classList.contains(TAB_BASE_CLASS) &&
          activeTrackerId !== null
        ) {
          setFilter(null);
        }
      },
      true
    );
  }

  // ---- 絞り込みと未読み込み一覧 --------------------------------------------

  /** フィルタON時、該当トラッカーに記録のある宛先以外の項目を隠す */
  function applyFilter() {
    const tracker = activeTracker();
    const entryMap = tracker ? entryMapOf(tracker) : null;
    const matched = new Set();
    for (const item of document.querySelectorAll(SELECTORS.listItem)) {
      const key = nameOfItem(item);
      const hit = entryMap ? entryMap.has(key) : false;
      if (hit) matched.add(key);
      item.classList.toggle(HIDDEN_CLASS, !!tracker && !hit);
    }
    const unmatched = tracker
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
    setFilter(null);

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
   * 一覧は直近分しか読み込まれないため、記録済みでも一覧に無いスレッドがある。
   * それらをフィルタON時に一覧末尾へ表示する（クリックでタイトル検索）。
   */
  function updateFilterNote(unmatchedEntries) {
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
    const label = activeTracker() ? activeTracker().label : "";
    note.textContent = "";
    const head = document.createElement("p");
    head.className = "stock-plus-filter-note-head";
    head.textContent = `この他に${label} ${unmatchedEntries.length}件（一覧に未読み込み。クリックで検索）:`;
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

  // ---- 一覧へのバッジ付与 ---------------------------------------------------

  function refreshBadges() {
    const items = document.querySelectorAll(SELECTORS.listItem);
    if (items.length === 0) return;

    for (const tracker of TRACKERS) {
      const entryMap = entryMapOf(tracker);
      for (const item of items) {
        const nameEl =
          item.querySelector(SELECTORS.listItemName) ||
          item.querySelector(SELECTORS.listItemNameFallback);
        if (!nameEl) continue;
        const existing = item.querySelector("." + tracker.badgeClass);
        const hit = entryMap.has(nameOfItem(item));
        if (hit && !existing) {
          const badge = document.createElement("span");
          badge.className = BADGE_BASE_CLASS + " " + tracker.badgeClass;
          badge.title = `${tracker.label}（Stock Plus）`;
          badge.textContent = tracker.badgeText;
          nameEl.appendChild(badge);
        } else if (!hit && existing) {
          existing.remove();
        }
      }
    }
  }

  // ---- DOM変化への追従 ------------------------------------------------------

  let refreshTimer = null;

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (!window.StockPlus.isCurrentInstance()) return;
      migrateLegacyEntries();
      detectMentionsInOpenChatrooms();
      ensureFilterTabs();
      refreshBadges();
      updateTabStates();
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
    name: "メッセージトラッキング（返信済み / @me）",
    init() {
      initReplyDetection();
      initFilterTabs();
      initObserver();
    },
  });
})();
