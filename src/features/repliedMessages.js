/**
 * Stock Plus - 機能: 返答済みメッセージトラッキング
 *
 * やること:
 *  1. メッセージ（チャット）で「送信」操作を検知し、宛先（トーク相手・グループ名）を
 *     localStorageに記録する（保存期間: 30日。期限切れは自動削除）。
 *  2. メッセージ一覧（チャットグループモーダル）の項目に「✓返答済み」バッジを付ける。
 *  3. フローティングボタンから「自身が返答したメッセージの宛先一覧」を
 *     時系列（新しい順）で表示するパネルを開ける。行クリックで該当スレッドを開く。
 *
 * セレクタは実際のStock（stock-app.jp）のDOM（2026-08確認）に合わせてある。
 * Stock側のDOM変更時は SELECTORS だけ直せば追従できる。
 */
(function () {
  "use strict";

  // ---- チューニングポイント: Stock側のDOMに合わせて調整する場所 ----------
  const SELECTORS = {
    // ヘッダーの「メッセージ」ボタン（チャットグループモーダルを開く）
    openChatModalButton: "button.openChatGroupsModalBtn",
    // メッセージ一覧の1項目
    listItem: "li.chatGroupListItem",
    // 一覧項目内の宛先名（ダイレクト / グループ）
    listItemName:
      ".chatGroupListItem__wrappedName, .chatGroupListItem__groupName",
    // 一覧項目のクリック対象（スレッドを開く領域）
    listItemClickTarget: ".chatGroupListItem__contentCell",
    // 開いているチャットウィンドウ
    chatroom: ".chatroom",
    // チャットウィンドウ内の宛先名（--forDirect等のmodifier差異を吸収）
    chatroomName: "[class*='chatroom__nameBox__name']",
    // 送信ボタン
    sendButton: ".chatroom__toolBar__sendBtn",
    // メッセージ入力欄
    composer: "textarea.chatroom__messageTextArea",
  };
  // ----------------------------------------------------------------------

  const store = new window.StockPlus.TtlStore("repliedMessages"); // TTL 30日

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
    scheduleBadgeRefresh();
    refreshPanelIfOpen();
  }

  // ---- 返答（送信）操作の検知 -------------------------------------------

  function initReplyDetection() {
    // 送信ボタンのクリック
    document.addEventListener(
      "click",
      (ev) => {
        if (!(ev.target instanceof Element)) return;
        const btn = ev.target.closest(SELECTORS.sendButton);
        if (!btn) return;
        recordReply(recipientOfChatroom(btn));
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

  // ---- 一覧への「✓返答済み」バッジ付与 ----------------------------------

  const BADGE_CLASS = "stock-plus-replied-badge";
  let badgeTimer = null;

  function scheduleBadgeRefresh() {
    if (badgeTimer) return;
    badgeTimer = setTimeout(() => {
      badgeTimer = null;
      refreshBadges();
    }, 300);
  }

  function refreshBadges() {
    const items = document.querySelectorAll(SELECTORS.listItem);
    if (items.length === 0) return;
    const recipients = new Set(store.load().map((e) => e.recipient));

    for (const item of items) {
      const nameEl = item.querySelector(SELECTORS.listItemName);
      if (!nameEl) continue;
      const existing = item.querySelector("." + BADGE_CLASS);
      const name = (nameEl.textContent || "").trim();
      const replied = recipients.has(name);
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

  function initBadgeObserver() {
    const observer = new MutationObserver(() => scheduleBadgeRefresh());
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleBadgeRefresh();
  }

  // ---- スレッドを開く（パネル行クリック時） -------------------------------

  /** メッセージモーダルを開き、宛先名が一致するスレッドをクリックする */
  function openThreadByName(recipient) {
    const findAndClick = () => {
      for (const item of document.querySelectorAll(SELECTORS.listItem)) {
        const nameEl = item.querySelector(SELECTORS.listItemName);
        if (nameEl && (nameEl.textContent || "").trim() === recipient) {
          const target =
            item.querySelector(SELECTORS.listItemClickTarget) || item;
          target.click();
          return true;
        }
      }
      return false;
    };

    if (findAndClick()) return;

    // 一覧が閉じている場合はモーダルを開いてから再試行
    const opener = document.querySelector(SELECTORS.openChatModalButton);
    if (!opener) return;
    opener.click();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      if (findAndClick() || attempts > 10) clearInterval(timer);
    }, 200);
  }

  // ---- 返答済み一覧パネル ------------------------------------------------

  const PANEL_ID = "stock-plus-replied-panel";

  function formatDate(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  }

  function renderPanelBody(panel) {
    const list = panel.querySelector(".stock-plus-panel-list");
    list.textContent = "";
    const entries = store.load().slice().sort((a, b) => b.savedAt - a.savedAt);

    if (entries.length === 0) {
      const empty = document.createElement("p");
      empty.className = "stock-plus-panel-empty";
      empty.textContent = "返答の記録はまだありません（記録は30日で自動削除されます）";
      list.appendChild(empty);
      return;
    }

    for (const e of entries) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "stock-plus-panel-row";
      row.title = "クリックでスレッドを開く";
      const name = document.createElement("span");
      name.className = "stock-plus-panel-recipient";
      name.textContent = e.recipient;
      const time = document.createElement("span");
      time.className = "stock-plus-panel-time";
      time.textContent = formatDate(e.savedAt);
      row.appendChild(name);
      row.appendChild(time);
      row.addEventListener("click", () => {
        panel.hidden = true;
        openThreadByName(e.recipient);
      });
      list.appendChild(row);
    }
  }

  function refreshPanelIfOpen() {
    const panel = document.getElementById(PANEL_ID);
    if (panel && !panel.hidden) renderPanelBody(panel);
  }

  function buildPanel() {
    const panel = document.createElement("div");
    panel.id = PANEL_ID;
    panel.hidden = true;

    const header = document.createElement("div");
    header.className = "stock-plus-panel-header";

    const title = document.createElement("span");
    title.textContent = "✓ 返答済みの宛先一覧";

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "stock-plus-panel-clear";
    clearBtn.textContent = "全削除";
    clearBtn.addEventListener("click", () => {
      if (confirm("返答済みの記録をすべて削除しますか？")) {
        store.clear();
        renderPanelBody(panel);
        refreshBadges();
      }
    });

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "stock-plus-panel-close";
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => (panel.hidden = true));

    header.appendChild(title);
    header.appendChild(clearBtn);
    header.appendChild(closeBtn);

    const list = document.createElement("div");
    list.className = "stock-plus-panel-list";

    panel.appendChild(header);
    panel.appendChild(list);
    return panel;
  }

  function initPanel() {
    const fab = document.createElement("button");
    fab.type = "button";
    fab.id = "stock-plus-fab";
    fab.title = "返答済み一覧（Stock Plus）";
    fab.textContent = "✓";

    const panel = buildPanel();

    fab.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) renderPanelBody(panel);
    });

    document.body.appendChild(fab);
    document.body.appendChild(panel);
  }

  // ---- 機能登録 ----------------------------------------------------------

  window.StockPlus.registerFeature({
    id: "replied-messages",
    name: "返答済みメッセージトラッキング",
    init() {
      initReplyDetection();
      initBadgeObserver();
      initPanel();
    },
  });
})();
