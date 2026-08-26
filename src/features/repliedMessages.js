/**
 * Stock Plus - 機能: 返答済みメッセージトラッキング
 *
 * やること:
 *  1. メッセージ画面で「送信/返信」操作を検知し、宛先（トーク相手・スレッド名）を
 *     localStorageに記録する（保存期間: 30日。期限切れは自動削除）。
 *  2. メッセージ一覧の項目に「✓返答済み」バッジを付ける。
 *  3. フローティングボタンから「自身が返答したメッセージの宛先一覧」を
 *     時系列（新しい順）で表示するパネルを開ける。
 *
 * StockはSPAでDOM構造が変わる可能性があるため、セレクタ類は
 * このファイル冒頭の SELECTORS にまとめてあり、ここだけ直せば追従できる。
 */
(function () {
  "use strict";

  // ---- チューニングポイント: Stock側のDOMに合わせて調整する場所 ----------
  const SELECTORS = {
    // メッセージ一覧の1項目とみなす候補（上から順に試す）
    listItem: [
      "[class*='messageList'] li",
      "[class*='message-list'] li",
      "[class*='threadList'] li",
      "[class*='talk'] li",
      "aside li",
      "nav li",
    ],
    // 開いているスレッドの宛先/タイトルの候補（上から順に試す）
    threadTitle: [
      "[class*='messageHeader'] [class*='title']",
      "[class*='message-header'] [class*='title']",
      "[class*='threadHeader']",
      "main header h1",
      "main header h2",
      "header [class*='title']",
    ],
    // 送信/返信ボタンとみなすテキスト・ラベルのパターン
    sendButtonText: /^(送信|返信|返信する|送信する|Send|Reply)$/,
    // メッセージ入力欄の候補
    composer: "textarea, [contenteditable='true']",
  };
  // ----------------------------------------------------------------------

  const store = new window.StockPlus.TtlStore("repliedMessages"); // TTL 30日

  /** 現在開いているスレッドの宛先名を取得する */
  function currentRecipient() {
    for (const sel of SELECTORS.threadTitle) {
      const el = document.querySelector(sel);
      const text = el && el.textContent && el.textContent.trim();
      if (text) return text;
    }
    // フォールバック: ページタイトル
    const t = document.title.replace(/\s*[-|｜].*$/, "").trim();
    return t || "(宛先不明)";
  }

  /** 返答を1件記録する */
  function recordReply() {
    const recipient = currentRecipient();
    const entry = store.upsert(
      {
        key: recipient + "::" + location.pathname,
        recipient: recipient,
        url: location.href,
      },
      "key"
    );
    console.info("[Stock Plus] 返答を記録:", entry.recipient);
    scheduleBadgeRefresh();
    refreshPanelIfOpen();
  }

  // ---- 返答（送信）操作の検知 -------------------------------------------

  function looksLikeSendButton(el) {
    const btn = el.closest("button, [role='button'], input[type='submit']");
    if (!btn) return null;
    const label =
      (btn.getAttribute("aria-label") || btn.value || btn.textContent || "").trim();
    return SELECTORS.sendButtonText.test(label) ? btn : null;
  }

  function initReplyDetection() {
    // クリックによる送信
    document.addEventListener(
      "click",
      (ev) => {
        if (!(ev.target instanceof Element)) return;
        if (looksLikeSendButton(ev.target)) recordReply();
      },
      true
    );

    // キーボードによる送信（Enter / Cmd+Enter / Ctrl+Enter を入力欄内で）
    document.addEventListener(
      "keydown",
      (ev) => {
        if (ev.key !== "Enter" || ev.isComposing) return;
        const target = ev.target;
        if (!(target instanceof Element) || !target.matches(SELECTORS.composer)) return;
        // Shift+Enter は改行とみなして無視。プレーンEnter/修飾付きEnterは送信扱い
        if (ev.shiftKey) return;
        const text = (target.value || target.textContent || "").trim();
        if (text) recordReply();
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

  function findListItems() {
    for (const sel of SELECTORS.listItem) {
      const items = document.querySelectorAll(sel);
      if (items.length > 0) return Array.from(items);
    }
    return [];
  }

  function refreshBadges() {
    const entries = store.load();
    if (entries.length === 0) return;
    const recipients = new Set(entries.map((e) => e.recipient));

    for (const item of findListItems()) {
      const hasBadge = item.querySelector("." + BADGE_CLASS);
      const text = (item.textContent || "").trim();
      const replied = Array.from(recipients).some((r) => r && text.includes(r));
      if (replied && !hasBadge) {
        const badge = document.createElement("span");
        badge.className = BADGE_CLASS;
        badge.title = "返答済み（Stock Plus）";
        badge.textContent = "✓ 返答済み";
        item.appendChild(badge);
      } else if (!replied && hasBadge) {
        hasBadge.remove();
      }
    }
  }

  function initBadgeObserver() {
    const observer = new MutationObserver(() => scheduleBadgeRefresh());
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleBadgeRefresh();
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
      const row = document.createElement("a");
      row.className = "stock-plus-panel-row";
      row.href = e.url || "#";
      const name = document.createElement("span");
      name.className = "stock-plus-panel-recipient";
      name.textContent = e.recipient;
      const time = document.createElement("span");
      time.className = "stock-plus-panel-time";
      time.textContent = formatDate(e.savedAt);
      row.appendChild(name);
      row.appendChild(time);
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
