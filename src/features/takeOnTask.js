/**
 * Stock Plus - 機能: 「対応します！」ボタン
 *
 * メッセージにホバーすると出る操作ボタン列（返信 / 了解しました / … / タスクを作成）の
 * 下に「対応します！」ボタンを追加する。押すと次の2つを一度に実行する。
 *
 *  1. 「了解しました」を押す（すでに了解済みなら押さない。押すと了解が外れるため）
 *  2. 「タスクを作成」のダイアログを開き、タスク名を
 *     「mm/dd hh:mm （投稿者）さんからの依頼を（自分）が対応する：「（本文の先頭）」」にして保存する。
 *     （mm/dd hh:mm はメッセージの投稿日時）
 *     誰からの依頼を、誰が（押した人）、どの内容について対応すると決めたかが、
 *     タスク一覧だけで分かるようにするため
 *
 * ノートに紐づかないメッセージの場合は、備考の先頭に「グループ：（グループ名）」を足す
 * （どのグループでのやり取りかが、ノートの代わりに分かるようにするため。本文は残す）。
 * 担当・期限などは、Stock標準の「タスクを作成」の初期値（担当=自分、期限=今日）のまま。
 * ボタンの置き場所は、設定画面のオプションで選べる。
 *  - 既定: 操作ボタン列の2行目（「了解しました」の真下）に追加
 *  - 「「了解しました」を「対応します！」に置き換える」をONにすると、未了解のときは
 *    「了解しました」ボタンを隠して、同じ位置に「対応します！」を出す
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
    // メッセージの投稿日時（「本日 12:03」「昨日 11:10」「11/16 (月) 13:51」の形）
    messageDate: ".chatListItem__topBox__date",
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
  // 設定画面のオプション: 「了解しました」を「対応します！」に置き換える（デフォルトOFF）
  const OPTION_REPLACE = "takeOnReplaceAck";
  const INLINE_CLASS = "stock-plus-takeon-inline";
  const ACK_HIDDEN_CLASS = "stock-plus-ack-hidden";
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

  // 行頭のメンション1つ分（「@武田 峻一さん: 」「@All: 」、およびかっこで括られた「（ @B: ）」も）。
  // 連続している場合は繰り返し取り除く
  const LEADING_MENTION_RE =
    /^[\s\u3000]*[（(「『【\[]?[\s\u3000]*@[^:：\n]{1,30}[:：][\s\u3000]*[）)」』】\]]?[\s\u3000]*/;
  // 行頭の呼びかけ（「武田さん、」「宮原さん，」など。短い名前＋さん＋読点のときだけ）
  const LEADING_ADDRESS_RE = /^[^\s、,，。！？!?「」]{1,15}さん[、,，]\s*/;

  // メンションを抜いたあとに残る、中身の無いかっこ（「（ ）」「（　）」など）
  const EMPTY_BRACKETS_RE = /[（(「『【\[][\s\u3000]*[）)」』】\]]/g;

  /**
   * 行頭のメンション・呼びかけを取り除く。
   * 中身が残らない（記号・かっこ・空白だけになる）場合は空文字を返す。
   */
  function stripLeadingAddress(line) {
    let t = line.trim();
    for (let prev = null; prev !== t; ) {
      prev = t;
      t = t.replace(LEADING_MENTION_RE, "").trim();
    }
    t = t.replace(LEADING_ADDRESS_RE, "").trim();
    t = t.replace(EMPTY_BRACKETS_RE, "").trim();
    // 文字や数字が1つも無ければ中身なし（「（ ）」「、」など）
    return /[\p{L}\p{N}]/u.test(t) ? t : "";
  }

  /**
   * 備考（本文）から、タスク名用の要約を作る。
   * 冒頭のメンションや「○○さん、」のような呼びかけは飛ばして、最初の中身のある文を使う。
   * 全部が呼びかけだけだった場合は、元の先頭行を使う。
   */
  function summarize(text) {
    const lines = (text || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    let line = "";
    for (const l of lines) {
      const stripped = stripLeadingAddress(l);
      if (stripped) {
        line = stripped;
        break;
      }
    }
    if (!line) line = lines[0] || "";
    const chars = Array.from(line);
    return chars.length > SUMMARY_MAX ? chars.slice(0, SUMMARY_MAX).join("") + "…" : line;
  }

  const pad2 = (n) => String(n).padStart(2, "0");

  /**
   * メッセージの投稿日時の表示を「mm/dd hh:mm」に変換する。
   * 表示は「本日 12:03」「昨日 11:10」「11/16 (月) 13:51」の3種類（年付きも許容）。
   * 読み取れなければ空文字を返す。
   */
  function formatMessageTime(text, now = new Date()) {
    const t = (text || "").replace(/\s+/g, " ").trim();
    const rel = t.match(/^(本日|昨日)\s+(\d{1,2}):(\d{2})/);
    if (rel) {
      const d = new Date(now);
      if (rel[1] === "昨日") d.setDate(d.getDate() - 1);
      return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(rel[2])}:${rel[3]}`;
    }
    const abs = t.match(/(?:\d{2,4}\/)?(\d{1,2})\/(\d{1,2})\s*(?:\([^)]*\))?\s*(\d{1,2}):(\d{2})/);
    if (abs) return `${pad2(abs[1])}/${pad2(abs[2])} ${pad2(abs[3])}:${abs[4]}`;
    return "";
  }

  /**
   * タスク名: mm/dd hh:mm 【（自分） 対応】（投稿者）さん「（本文の先頭）」
   * 分からない要素は省略する（日時が読めなければ先頭を省く、投稿者が分からなければ
   * 「さん」ごと省く、自分の名前が分からなければ「自分」）。
   */
  function buildTitle(stamp, assignee, sender, summary) {
    const who = assignee || "自分";
    const from = sender ? `${sender}さん` : "";
    const body = summary ? `「${summary}」` : "";
    return `${stamp ? stamp + " " : ""}【${who} 対応】${from}${body}`;
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
    const stamp = formatMessageTime(msg.querySelector(SELECTORS.messageDate)?.textContent);
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
      const taskTitle = buildTitle(stamp, assignee, sender, summary);
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

  /** 「対応します！」ボタンを作る。既存ボタンと同じ「アイコン＋ラベル」の構成で、色・サイズは既存のスタイルを継承 */
  function createTakeOnButton(msg) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.stockPlusInstance = window.StockPlus.instanceId;
    btn.innerHTML = ICON_SVG + "<span>対応します！</span>";
    btn.title =
      "「了解しました」を押して、「mm/dd hh:mm 【自分 対応】投稿者さん「本文」」のタスクを作成します（Stock Plus）";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      takeOn(msg, btn);
    });
    return btn;
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
    row.appendChild(createTakeOnButton(msg));
    return row;
  }

  /** このプラグインが足したもの（2行目・置き換えボタン・「了解しました」の非表示）をすべて元に戻す */
  function clearExtras(box) {
    box.querySelector("." + ROW_CLASS)?.remove();
    box.querySelector("." + INLINE_CLASS)?.remove();
    box.classList.remove(EXTRA_CLASS);
    box.querySelectorAll("." + ACK_HIDDEN_CLASS).forEach((b) => b.classList.remove(ACK_HIDDEN_CLASS));
  }

  function ensureRows() {
    const enabled = window.StockPlus.isFeatureEnabled(SETTING_ID);
    const replace = window.StockPlus.getOption(OPTION_REPLACE, false) === true;
    for (const msg of document.querySelectorAll(SELECTORS.chatListItem)) {
      const box = msg.querySelector(SELECTORS.toolBox);
      if (!box) continue;
      const ack = ackButtonOf(box);

      // 設定OFF、または「了解しました」の無いメッセージ（自分の発言など）には出さない
      if (!enabled || !ack) {
        clearExtras(box);
        continue;
      }

      if (replace) {
        // 置き換えモード: 2行目は使わず、「了解しました」の位置に「対応します！」を出す
        box.querySelector("." + ROW_CLASS)?.remove();
        box.classList.remove(EXTRA_CLASS);
        let inline = box.querySelector("." + INLINE_CLASS);
        if (inline && inline.dataset.stockPlusInstance !== window.StockPlus.instanceId) {
          inline.remove(); // 旧インスタンスのボタンはハンドラが無効なので作り直す
          inline = null;
        }
        if (!inline) {
          inline = createTakeOnButton(msg);
          inline.classList.add(INLINE_CLASS);
        }
        if (ack.nextElementSibling !== inline) ack.insertAdjacentElement("afterend", inline);
        // 未了解のときだけ「了解しました」を隠す（了解済みなら「了解解除」は残して、取り消せるようにする）
        const notAcked = (ack.textContent || "").trim() === SELECTORS.ackLabel;
        ack.classList.toggle(ACK_HIDDEN_CLASS, notAcked);
        continue;
      }

      // 既定モード: 2行目に追加する
      box.querySelector("." + INLINE_CLASS)?.remove();
      box.querySelectorAll("." + ACK_HIDDEN_CLASS).forEach((b) => b.classList.remove(ACK_HIDDEN_CLASS));
      let row = box.querySelector("." + ROW_CLASS);
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
