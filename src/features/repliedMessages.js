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
    // 一覧項目内の宛先名（ダイレクト / グループ）
    listItemName:
      ".chatGroupListItem__wrappedName, .chatGroupListItem__groupName",
    // 一覧モーダルのタブ行（すべて／ノートに紐づく／ノートに紐づかない）
    tabBox: ".chatGroupsModal__tabBox",
    // Stock標準のタブ
    stockTab: ".chatGroupsModal__tabBox__tab",
    // 開いているチャットウィンドウ
    chatroom: ".chatroom",
    // チャットウィンドウ内の宛先名（--forDirect等のmodifier差異を吸収）
    chatroomName: "[class*='chatroom__nameBox__name']",
    // 送信ボタン
    sendButton: ".chatroom__toolBar__sendBtn",
    // 各メッセージの操作ボックス（「了解しました」ボタンが入っている。ボタン自体はクラス無し）
    ackButtonBox: ".chatListItemToolBox",
    // 「了解しました」ボタンのラベル（完全一致）
    ackButtonText: "了解しました",
    // メッセージ入力欄
    composer: "textarea.chatroom__messageTextArea",
  };
  // ----------------------------------------------------------------------

  const BADGE_CLASS = "stock-plus-replied-badge";
  const TAB_CLASS = "stock-plus-replied-tab";
  const HIDDEN_CLASS = "stock-plus-hidden";

  const store = new window.StockPlus.TtlStore("repliedMessages"); // TTL 30日
  let filterActive = false;

  function repliedRecipients() {
    return new Set(store.load().map((e) => e.recipient));
  }

  /** 一覧項目の宛先名（自前バッジのテキストを除外して取得） */
  function nameOfItem(item) {
    const el = item.querySelector(SELECTORS.listItemName);
    if (!el) return "";
    let text = "";
    for (const node of el.childNodes) {
      if (node.nodeType === 1 && node.classList.contains(BADGE_CLASS)) continue;
      text += node.textContent;
    }
    return text.trim();
  }

  // ---- 返答（送信）操作の検知 -------------------------------------------

  /** チャットウィンドウ内の要素から宛先名を取得する */
  function recipientOfChatroom(el) {
    const room = el.closest(SELECTORS.chatroom);
    if (!room) return null;
    const nameEl = room.querySelector(SELECTORS.chatroomName);
    const text = nameEl && nameEl.textContent && nameEl.textContent.trim();
    return text || null;
  }

  /** 返答を1件記録する */
  function recordReply(recipient) {
    if (!recipient) return;
    store.upsert({ key: recipient, recipient: recipient }, "key");
    console.info("[Stock Plus] 返答を記録:", recipient);
    scheduleRefresh();
  }

  function initReplyDetection() {
    // 送信ボタン / 「了解しました」ボタンのクリック
    document.addEventListener(
      "click",
      (ev) => {
        if (!(ev.target instanceof Element)) return;

        const sendBtn = ev.target.closest(SELECTORS.sendButton);
        if (sendBtn) {
          recordReply(recipientOfChatroom(sendBtn));
          return;
        }

        const ackBtn = ev.target.closest(SELECTORS.ackButtonBox + " button");
        if (ackBtn && (ackBtn.textContent || "").trim() === SELECTORS.ackButtonText) {
          recordReply(recipientOfChatroom(ackBtn));
        }
      },
      true
    );

    // Cmd+Enter / Ctrl+Enter による送信（入力欄内）
    document.addEventListener(
      "keydown",
      (ev) => {
        if (ev.key !== "Enter" || !(ev.metaKey || ev.ctrlKey)) return;
        const target = ev.target;
        if (!(target instanceof Element) || !target.matches(SELECTORS.composer)) return;
        if (!(target.value || "").trim()) return;
        recordReply(recipientOfChatroom(target));
      },
      true
    );
  }

  // ---- 「返信済み」フィルタタブ ------------------------------------------

  function ensureFilterTab() {
    const box = document.querySelector(SELECTORS.tabBox);
    if (!box || box.querySelector("." + TAB_CLASS)) return;

    const tab = document.createElement("a");
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
    const count = repliedRecipients().size;
    tab.textContent = count > 0 ? `返信済み(${count})` : "返信済み";
  }

  /** フィルタON時、返信したことのある宛先以外の項目を隠す */
  function applyFilter() {
    const recipients = repliedRecipients();
    for (const item of document.querySelectorAll(SELECTORS.listItem)) {
      const hide = filterActive && !recipients.has(nameOfItem(item));
      item.classList.toggle(HIDDEN_CLASS, hide);
    }
  }

  function initFilterTab() {
    // Stock標準タブをクリックしたら自前フィルタは解除する
    document.addEventListener(
      "click",
      (ev) => {
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
    const recipients = repliedRecipients();

    for (const item of items) {
      const nameEl = item.querySelector(SELECTORS.listItemName);
      if (!nameEl) continue;
      const existing = item.querySelector("." + BADGE_CLASS);
      const replied = recipients.has(nameOfItem(item));
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
