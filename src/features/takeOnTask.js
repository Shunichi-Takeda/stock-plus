/**
 * Stock Plus - 機能: 「対応します！」ボタン
 *
 * メッセージにホバーすると出る操作ボタン列（返信 / 了解しました / … / タスクを作成）の
 * 下に「対応します！」ボタンを追加する。押すと次の2つを一度に実行する。
 *
 *  1. 「了解しました」を押す（すでに了解済みなら押さない。押すと了解が外れるため）
 *  2. 「タスクを作成」のダイアログを開き、タスク名を
 *     「【（担当者）が対応を承る】（送信者）さん「（本文の先頭）」」にして保存する。
 *     誰が（押した人）、誰の何を（送信者とメッセージ内容）対応すると決めたかが、
 *     タスク一覧だけで分かるようにするため
 *
 * ノートに紐づかないメッセージの場合は、備考の先頭に「グループ：（グループ名）」を足す
 * （どのグループでのやり取りかが、ノートの代わりに分かるようにするため。本文は残す）。
 * 担当・期限などは、Stock標準の「タスクを作成」の初期値（担当=自分、期限=今日）のまま。
 * 設定画面で「作成後にタスクを開く」をONにしている場合は、保存後にタスク一覧から
 * 作成したタスクを探して編集画面を開き、閉じたら元の画面へ戻す（デフォルトOFF）。
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
    ackedLabel: "了解解除",
    taskLabel: "タスクを作成",
    // 「タスクを作成」ダイアログ
    taskModal: ".taskModal",
    taskTitleInput: ".taskModal__titleBox__title",
    taskComment: ".taskModal__comment",
    // ダイアログの「ノート：○○」リンク。ノートに紐づかないメッセージでは文字が「-」になる
    taskNoteLink: ".taskModal__noteLnkBox__lnk",
    // チャットウィンドウの名前（グループ名。1対1のときは相手の名前）
    roomName: "[class*='chatroom__nameBox__name'], .chatroom__nameBox__memberNames",
    // ダイアログの「依頼：○○ >>> 担当：○○」の名前（担当の初期値は押した本人）
    taskMemberName: ".taskModal__membersBox__name",
    // メッセージの送信者名
    senderName: ".chatListItem__topBox [class*='chatListItem__topBox__name']",
    taskSaveButton: "button.btn.blue",
    // タスク一覧（保存したタスクを探して開き直すのに使う）
    taskListItem: "li.taskListTaskItem",
    taskListName: ".taskListTaskItem__nameCell__taskName",
    taskListNameCell: ".taskListTaskItem__nameCell",
  };
  // ----------------------------------------------------------------------

  const SETTING_ID = "take-on-task";
  // 設定画面のオプション: 作成後にタスクの編集画面を開く（デフォルトOFF）
  const OPTION_REOPEN = "takeOnReopen";
  const ROW_CLASS = "stock-plus-takeon-row";
  const EXTRA_CLASS = "stock-plus-has-extra-row";
  const SUMMARY_MAX = 40;
  // 既存ボタンのアイコン（高さ11px・currentColor）に合わせた、二重チェックのアイコン
  const ICON_SVG =
    '<svg viewBox="0 0 16 11" height="11" width="16" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="1,6 4.5,9.5 10,2"/><polyline points="7,9.5 8,9.5 15,2"/></svg>';

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

  /**
   * タスク名: 【（担当者）が対応を承る】（送信者）さん「（本文の先頭）」
   * 分からない要素は省略する（担当者が分からなければ「【対応を承る】」）。
   */
  function buildTitle(assignee, sender, summary) {
    const head = assignee ? `【${assignee}が対応を承る】` : "【対応を承る】";
    const from = sender ? `${sender}さん` : "";
    const body = summary ? `「${summary}」` : "";
    return head + from + body;
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

  // ---- 作成後にタスクを開く（オプション） ----------------------------------------

  /** StockのSPAルーター（History API）に乗せて画面遷移する（ページ再読込なし） */
  function navigate(path) {
    if (location.pathname + location.search === path) return;
    history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }

  /**
   * 保存したタスクをタスク一覧から探して編集画面を開く。
   * メッセージから作ったタスクがチャットに「作成しました」と出るとは限らないため、
   * 確実に見つかるタスク一覧を経由する。ダイアログを閉じたら元の画面へ戻す。
   */
  async function reopenCreatedTask(title) {
    const team = (location.pathname.match(/^\/teams\/([^/]+)/) || [])[1];
    if (!team) return;
    const origin = location.pathname + location.search;
    const listPath = `/teams/${team}/dashboard/tasks`;

    navigate(listPath);
    const nameCell = await waitFor(() => {
      for (const item of document.querySelectorAll(SELECTORS.taskListItem)) {
        const name = item.querySelector(SELECTORS.taskListName);
        if (name && (name.textContent || "").trim() === title) {
          return item.querySelector(SELECTORS.taskListNameCell);
        }
      }
      return null;
    }, 8000, 250);

    if (!nameCell) {
      navigate(origin);
      alert("作成したタスクをタスク一覧から見つけられなかったため、開けませんでした。");
      return;
    }
    nameCell.click();
    if (!(await waitFor(openTaskModal, 4000))) {
      navigate(origin);
      return;
    }
    // 編集画面が閉じられるまで待ち、まだタスク一覧にいれば元の画面へ戻す（最大30分）
    await waitFor(() => !openTaskModal(), 30 * 60 * 1000, 500);
    if (location.pathname === listPath) navigate(origin);
  }

  /** 「対応します！」の本処理 */
  async function takeOn(msg, btn) {
    const room = msg.closest(SELECTORS.chatroom);
    const signature = (msg.querySelector(".chatListItem__message")?.textContent || "").trim();
    // 送信者はダイアログを開く前（画面が作り直される前）に控えておく
    const sender = (msg.querySelector(SELECTORS.senderName)?.textContent || "").trim();
    const groupName = (room?.querySelector(SELECTORS.roomName)?.textContent || "").trim();
    let box = currentBox(msg, room, signature);
    if (!box) return;
    btn.disabled = true;
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
      // 担当者名（「依頼：○ >>> 担当：○」の後ろ側）。初期値は押した本人
      const names = modal.querySelectorAll(SELECTORS.taskMemberName);
      const assignee = names.length ? (names[names.length - 1].textContent || "").trim() : "";
      const taskTitle = buildTitle(assignee, sender, summary);
      setNativeValue(titleInput, taskTitle);

      // ノートに紐づかないメッセージは、備考の先頭にグループ名を入れる（本文は残す）
      const noteLink = modal.querySelector(SELECTORS.taskNoteLink);
      const noNote = !noteLink || ["", "-"].includes((noteLink.textContent || "").trim());
      if (noNote && groupName && comment) {
        const label = `グループ：${groupName}`;
        if (!comment.value.startsWith(label)) {
          setNativeValue(comment, comment.value ? `${label}\n\n${comment.value}` : label);
        }
      }
      await sleep(250);

      const save = Array.from(modal.querySelectorAll(SELECTORS.taskSaveButton)).find(
        (b) => (b.textContent || "").trim() === "保存"
      );
      if (!save) return; // 保存ボタンが見つからなければ、利用者が押せるよう開いたままにする
      save.click();
      // 保存されればダイアログが閉じる。閉じない場合は入力不備などなので、そのまま利用者に委ねる
      const saved = await waitFor(() => !openTaskModal(), 4000);
      if (saved && window.StockPlus.getOption(OPTION_REOPEN, false) === true) {
        reopenCreatedTask(taskTitle); // 完了を待たず、ボタンはすぐ使える状態に戻す
      }
    } finally {
      btn.disabled = false;
    }
  }

  // ---- 各メッセージの操作ボックスに2行目を追加 --------------------------------

  /** 「了解しました」（または了解済みの「了解解除」）のボタン。自分のメッセージには無い */
  function ackButtonOf(box) {
    return buttonByLabel(box, SELECTORS.ackLabel) || buttonByLabel(box, SELECTORS.ackedLabel);
  }

  /** 2行目を作る。「了解しました」の真下に揃えるため、それより前のボタンと同じ幅の見えない余白を置く */
  function buildRow(msg, box) {
    const row = document.createElement("div");
    row.className = ROW_CLASS;
    row.dataset.stockPlusInstance = window.StockPlus.instanceId;

    const ack = ackButtonOf(box);
    for (const b of box.querySelectorAll(":scope > button")) {
      if (b === ack) break;
      const spacer = b.cloneNode(true);
      spacer.className = "stock-plus-takeon-spacer";
      spacer.setAttribute("aria-hidden", "true");
      spacer.tabIndex = -1;
      row.appendChild(spacer);
    }

    // 既存ボタンと同じ「アイコン＋ラベル」の構成にして、色・サイズも既存のスタイルを継承する
    const btn = document.createElement("button");
    btn.type = "button";
    btn.innerHTML = ICON_SVG + "<span>対応します！</span>";
    btn.title = "「了解しました」を押して、「【自分が対応を承る】送信者さん「本文」」のタスクを作成します（Stock Plus）";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      takeOn(msg, btn);
    });
    row.appendChild(btn);
    return row;
  }

  function ensureRows() {
    const enabled = window.StockPlus.isFeatureEnabled(SETTING_ID);
    for (const msg of document.querySelectorAll(SELECTORS.chatListItem)) {
      const box = msg.querySelector(SELECTORS.toolBox);
      if (!box) continue;
      let row = box.querySelector("." + ROW_CLASS);

      // 設定OFF、または「了解しました」の無いメッセージ（自分の発言など）には出さない
      if (!enabled || !ackButtonOf(box)) {
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
        box.appendChild(buildRow(msg, box));
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
