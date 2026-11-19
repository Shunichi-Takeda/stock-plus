/**
 * Stock Plus - 機能: 「対応します！」ボタン
 *
 * メッセージにホバーすると出る操作ボタン列（返信 / 了解しました / … / タスクを作成）の
 * 下に「対応します！」ボタンを追加する。押すと次の2つを一度に実行する。
 *
 *  1. 「了解しました」を押す（すでに了解済みなら押さない。押すと了解が外れるため）
 *  2. 「タスクを作成」のダイアログを開き、タスク名を「対応を承る：（本文の先頭）」にして保存する
 *
 * タスクの担当・期限などは、Stock標準の「タスクを作成」の初期値（担当=自分、期限=今日）のまま。
 * 保存できなかった場合（入力不備など）は、ダイアログを開いたままにして利用者に委ねる。
 */
(function () {
  "use strict";

  // ---- チューニングポイント: Stock側のDOMに合わせて調整する場所 ----------
  const SELECTORS = {
    chatroom: ".chatroom",
    chatListItem: "li.chatListItem",
    // メッセージの操作ボックス（ホバーで表示される。この中に既存ボタンが並ぶ）
    toolBox: ".chatListItemToolBox",
    toolBoxButtons: ".chatListItemToolBox button",
    // 既存ボタンのラベル
    ackLabel: "了解しました", // 未了解のとき。了解済みのときは「了解解除」
    taskLabel: "タスクを作成",
    // 「タスクを作成」ダイアログ
    taskModal: ".taskModal",
    taskTitleInput: ".taskModal__titleBox__title",
    taskComment: ".taskModal__comment",
    taskSaveButton: "button.btn.blue",
  };
  // ----------------------------------------------------------------------

  const SETTING_ID = "take-on-task";
  const ROW_CLASS = "stock-plus-takeon-row";
  const EXTRA_CLASS = "stock-plus-has-extra-row";
  const TITLE_PREFIX = "対応を承る";
  const SUMMARY_MAX = 30;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function buttonByLabel(box, label) {
    return Array.from(box.querySelectorAll("button")).find(
      (b) => (b.textContent || "").trim() === label
    );
  }

  /** 条件が満たされるまで待つ（最大 timeout ms） */
  async function waitFor(fn, timeout = 4000, step = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  }

  function openTaskModal() {
    return Array.from(document.querySelectorAll(SELECTORS.taskModal)).find((m) =>
      m.classList.contains("show")
    );
  }

  /** 備考（本文）の先頭行を、タスク名用に短く整える */
  function summarize(text) {
    const line =
      (text || "")
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0) || "";
    const chars = Array.from(line);
    return chars.length > SUMMARY_MAX ? chars.slice(0, SUMMARY_MAX).join("") + "…" : line;
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /**
   * メッセージの現在の操作ボックスを取得する。
   * 「了解しました」を押すとStockが画面を作り直すことがあり、押す前に掴んだ要素が
   * 外れている場合があるため、外れていたら同じ本文のメッセージを探し直す。
   */
  function currentBox(msg, room, signature) {
    if (msg.isConnected) return msg.querySelector(SELECTORS.toolBox);
    if (!room || !room.isConnected) return null;
    for (const li of room.querySelectorAll(SELECTORS.chatListItem)) {
      const text = (li.querySelector(".chatListItem__message")?.textContent || "").trim();
      if (text === signature && li.querySelector(SELECTORS.toolBox)) {
        return li.querySelector(SELECTORS.toolBox);
      }
    }
    return null;
  }

  /** 「対応します！」の本処理 */
  async function takeOn(msg, btn) {
    const room = msg.closest(SELECTORS.chatroom);
    const signature = (msg.querySelector(".chatListItem__message")?.textContent || "").trim();
    let box = currentBox(msg, room, signature);
    if (!box) return;
    btn.disabled = true;
    const originalText = btn.textContent;
    try {
      // 1. 了解しました（未了解のときだけ）
      const ack = buttonByLabel(box, SELECTORS.ackLabel);
      if (ack) {
        ack.click();
        await sleep(600);
        box = currentBox(msg, room, signature) || box;
      }

      // 2. タスクを作成
      const taskBtn = await waitFor(() => {
        box = currentBox(msg, room, signature) || box;
        return buttonByLabel(box, SELECTORS.taskLabel);
      }, 2500);
      if (!taskBtn) {
        alert("「タスクを作成」ボタンが見つからないため、タスクは作成していません。");
        return;
      }
      taskBtn.click();
      const modal = await waitFor(openTaskModal, 4000);
      if (!modal) {
        alert("タスク作成ダイアログを開けませんでした。");
        return;
      }
      const titleInput = modal.querySelector(SELECTORS.taskTitleInput);
      if (!titleInput) return;
      // 備考には本文が自動で入る。その先頭行をタスク名に使う
      const comment = modal.querySelector(SELECTORS.taskComment);
      const summary = summarize(comment ? comment.value : "");
      setNativeValue(titleInput, summary ? `${TITLE_PREFIX}：${summary}` : TITLE_PREFIX);
      await sleep(250);

      const save = Array.from(modal.querySelectorAll(SELECTORS.taskSaveButton)).find(
        (b) => (b.textContent || "").trim() === "保存"
      );
      if (!save) return; // 保存ボタンが見つからなければ、利用者が押せるよう開いたままにする
      save.click();
      // 保存されればダイアログが閉じる。閉じない場合は入力不備などなので、そのまま利用者に委ねる
      await waitFor(() => !openTaskModal(), 4000);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  // ---- 各メッセージの操作ボックスに2行目を追加 --------------------------------

  function ensureRows() {
    const enabled = window.StockPlus.isFeatureEnabled(SETTING_ID);
    for (const msg of document.querySelectorAll(SELECTORS.chatListItem)) {
      const box = msg.querySelector(SELECTORS.toolBox);
      if (!box) continue;
      let row = box.querySelector("." + ROW_CLASS);

      if (!enabled) {
        if (row) row.remove();
        box.classList.remove(EXTRA_CLASS);
        continue;
      }
      // 旧インスタンスが作った行はハンドラが無効なので作り直す
      if (row && row.dataset.stockPlusInstance !== window.StockPlus.instanceId) {
        row.remove();
        row = null;
      }
      if (!row) {
        row = document.createElement("div");
        row.className = ROW_CLASS;
        row.dataset.stockPlusInstance = window.StockPlus.instanceId;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = "対応します！";
        btn.title = "「了解しました」を押して、「対応を承る」タスクを作成します（Stock Plus）";
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          takeOn(msg, btn);
        });
        row.appendChild(btn);
        box.appendChild(row);
      }
      box.classList.add(EXTRA_CLASS);
    }
  }

  let timer = null;

  function scheduleRefresh() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!window.StockPlus.isCurrentInstance()) return;
      ensureRows();
    }, 200);
  }

  window.StockPlus.registerFeature({
    id: "take-on-task",
    name: "「対応します！」ボタン",
    init() {
      const observer = new MutationObserver(() => scheduleRefresh());
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleRefresh();
    },
    refresh: scheduleRefresh,
  });
})();
