/**
 * Stock Plus - 機能: 「対応します！」ボタン
 *
 * メッセージにホバーすると出る操作ボタン列（返信 / 了解しました / … / タスクを作成）の
 * 「了解しました」を「対応します！」に置き換える。押すと次の2つを一度に実行する。
 *
 *  1. 「了解しました」を押す（すでに了解済みなら押さない。押すと了解が外れるため）
 *  2. 「タスクを作成」のダイアログを開き、タスク名を
 *     「【（自分） 対応】（投稿者）さん「（本文の先頭）」」にして保存する。
 *     誰が（押した人）、誰の、どの内容について対応すると決めたかが、
 *     タスク一覧だけで分かるようにするため
 *
 * 置き換えの扱い:
 *  - 未了解のメッセージでは「了解しました」を隠して、同じ位置に「対応します！」を出す
 *  - 了解済みのメッセージでは、「了解解除」を「対応解除」の表記に置き換えて残す
 *    （押すとStock標準の了解解除が働く）。「対応します！」はその間は出さない
 *  - 自分の発言など「了解しました」の無いメッセージには出さない
 *
 * ノートに紐づかないメッセージの場合は、備考の先頭に「グループ：（グループ名）」を足す
 * （どのグループでのやり取りかが、ノートの代わりに分かるようにするため。本文は残す）。
 * 担当・期限などは、Stock標準の「タスクを作成」の初期値（担当=自分、期限=今日）のまま。
 *
 * 設定画面のオプション「保存せず、タスク設定画面を開いたままにする」をONにすると、
 * タスク名・備考を入れたところで止めて、保存は利用者が自分で行う（デフォルトOFF=自動保存）。
 * 自動保存で保存できなかった場合（入力不備など）も、ダイアログを開いたままにして利用者に委ねる。
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
    // 「了解解除」を置き換えて見せる文言（対応します！を押したあとの解除リンク）
    takeOnAckedLabel: "対応解除",
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
  };
  // ----------------------------------------------------------------------

  const SETTING_ID = "take-on-task";
  // 設定画面のオプション: 保存せず、タスク設定画面を開いたままにする（デフォルトOFF）
  const OPTION_KEEP_OPEN = "takeOnKeepOpen";
  const INLINE_CLASS = "stock-plus-takeon-inline";
  const ACK_HIDDEN_CLASS = "stock-plus-ack-hidden";
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

  /**
   * タスク名: 【（自分） 対応】（投稿者）さん「（本文の先頭）」
   * 分からない要素は省略する（投稿者が分からなければ「さん」ごと省く、
   * 自分の名前が分からなければ「自分」）。
   */
  function buildTitle(assignee, sender, summary) {
    const who = assignee || "自分";
    const from = sender ? `${sender}さん` : "";
    const body = summary ? `「${summary}」` : "";
    return `【${who} 対応】${from}${body}`;
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

      // 「保存せず開いたままにする」オプションがONなら、ここで止めて利用者に委ねる
      if (window.StockPlus.getOption(OPTION_KEEP_OPEN, false) === true) return;

      const save = Array.from(modal.querySelectorAll(SELECTORS.taskSaveButton)).find(
        (b) => (b.textContent || "").trim() === "保存"
      );
      if (!save) return; // 保存ボタンが見つからなければ、利用者が押せるよう開いたままにする
      save.click();
      // 保存されればダイアログが閉じる。閉じない場合は入力不備などなので、そのまま利用者に委ねる
      await waitFor(() => !openTaskModal(), 4000);
    } finally {
      btn.disabled = false;
    }
  }

  // ---- 各メッセージの操作ボックスで「了解しました」を置き換える ---------------------

  /** 「了解しました」（または了解済みの「了解解除」）のボタン。自分のメッセージには無い */
  function ackButtonOf(box) {
    return (
      buttonByLabel(box, SELECTORS.ackLabel) ||
      buttonByLabel(box, SELECTORS.ackedLabel) ||
      buttonByLabel(box, SELECTORS.takeOnAckedLabel) // 当拡張が「了解解除」を置き換えたもの
    );
  }

  /** 「了解解除」のラベルを「対応解除」に見せる（表記だけの置き換え。動作はStock標準のまま） */
  function relabelAcked(ack) {
    const label = ack.querySelector("span");
    if (!label || (label.textContent || "").trim() !== SELECTORS.ackedLabel) return;
    label.textContent = SELECTORS.takeOnAckedLabel;
    ack.dataset.stockPlusRelabeled = "1";
  }

  /** 置き換えた表記を「了解解除」に戻す */
  function restoreAckedLabel(box) {
    for (const b of box.querySelectorAll("button[data-stock-plus-relabeled]")) {
      const label = b.querySelector("span");
      if (label && (label.textContent || "").trim() === SELECTORS.takeOnAckedLabel) {
        label.textContent = SELECTORS.ackedLabel;
      }
      delete b.dataset.stockPlusRelabeled;
    }
  }

  /** 「対応します！」ボタンを作る。既存ボタンと同じ「アイコン＋ラベル」の構成で、色・サイズは既存のスタイルを継承 */
  function createTakeOnButton(msg) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.stockPlusInstance = window.StockPlus.instanceId;
    btn.innerHTML = ICON_SVG + "<span>対応します！</span>";
    btn.title =
      "「了解しました」を押して、「【自分 対応】投稿者さん「本文」」のタスクを作成します（Stock Plus）";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      takeOn(msg, btn);
    });
    return btn;
  }

  /** このプラグインが足したもの（置き換えボタン・「了解しました」の非表示・解除の表記）をすべて元に戻す */
  function clearExtras(box) {
    box.querySelector("." + INLINE_CLASS)?.remove();
    box.querySelectorAll("." + ACK_HIDDEN_CLASS).forEach((b) => b.classList.remove(ACK_HIDDEN_CLASS));
    restoreAckedLabel(box);
  }

  function ensureButtons() {
    const enabled = window.StockPlus.isFeatureEnabled(SETTING_ID);
    for (const msg of document.querySelectorAll(SELECTORS.chatListItem)) {
      const box = msg.querySelector(SELECTORS.toolBox);
      if (!box) continue;
      const ack = ackButtonOf(box);

      // 設定OFF、または「了解しました」の無いメッセージ（自分の発言など）には出さない
      if (!enabled || !ack) {
        clearExtras(box);
        continue;
      }

      const notAcked = (ack.textContent || "").trim() === SELECTORS.ackLabel;

      // 了解済み: 「了解解除」を「対応解除」の表記にし、「対応します！」は出さない
      if (!notAcked) {
        box.querySelector("." + INLINE_CLASS)?.remove();
        ack.classList.remove(ACK_HIDDEN_CLASS);
        relabelAcked(ack);
        continue;
      }

      // 未了解: 「了解しました」を隠して、同じ位置に「対応します！」を出す
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
      ack.classList.add(ACK_HIDDEN_CLASS);
    }
  }

  let timer = null;

  function scheduleRefresh() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!window.StockPlus.isCurrentInstance()) return;
      ensureButtons();
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
