/**
 * Stock Plus - 機能: 全員に返信（メンション引き継ぎ）
 *
 * メッセージの「返信」ボタンを押した際、Stock標準は送信者のメンション
 * （"@送信者さん: "）だけを入力欄に挿入する。この機能は、元メッセージ本文に
 * 含まれる**全メンション**（かっこ付き・別行のメンションも含む）を入力欄へ
 * 追記する（Gmailの「全員に返信」相当）。
 *
 *  - 自分宛メンション（.mentionToMe）は除外する
 *  - 送信者や既に入力欄にあるメンションと重複するものはスキップ
 *  - 挿入形式はStockの返信ボタンと同じプレーンテキスト "@名前さん: "
 *  - メンション前後のかっこは、間に空白（半角/全角）があっても引き継ぐ。
 *    「（@A: @B: ）」のように複数メンションを括るかっこも、その形のまま再現する
 */
(function () {
  "use strict";

  // ---- チューニングポイント: Stock側のDOMに合わせて調整する場所 ----------
  const SELECTORS = {
    chatroom: ".chatroom",
    // メッセージ1件
    chatListItem: "li.chatListItem",
    // メッセージの操作ボックス（返信/了解しました等）
    toolBoxButtons: ".chatListItemToolBox button, .chatListItemToolBox a",
    // 「返信」ボタンのラベル（完全一致）
    replyButtonText: "返信",
    // 他人宛メンション
    mention: ".mention",
    // 自分宛メンション（挿入はしないが、かっこの括りの判定には使う）
    mentionToMe: ".mentionToMe",
  };
  // ----------------------------------------------------------------------

  const SETTING_ID = "reply-all-mentions";

  const OPEN_BRACKETS = "（(「『【[｛{＜<";
  const CLOSE_BRACKETS = "）)」』】]｝}＞>";
  // かっことメンションの間に挟まりうる空白（半角/全角/NBSP/タブ）
  const SPACE_RE = /[ \t\u3000\u00a0]/;

  /**
   * メンション要素から指定方向へ兄弟ノードをたどり、空白を読み飛ばした
   * 最初の文字を返す。改行（<br>）や他の要素に当たったら打ち切る
   * （別の行のかっこを誤って拾わないため）。
   * after方向では、名前直後の ":"（半角/全角）も読み飛ばす。
   */
  function firstCharBeside(el, direction) {
    const forward = direction === "after";
    let node = forward ? el.nextSibling : el.previousSibling;
    let skippedColon = false;
    while (node) {
      if (node.nodeType !== 3) return ""; // <br>・別メンション等の要素で打ち切り
      const text = node.textContent;
      const chars = forward ? Array.from(text) : Array.from(text).reverse();
      for (const ch of chars) {
        if (SPACE_RE.test(ch)) continue;
        if (forward && !skippedColon && (ch === ":" || ch === "：")) {
          skippedColon = true;
          continue;
        }
        return ch;
      }
      node = forward ? node.nextSibling : node.previousSibling;
    }
    return "";
  }

  function bracketBefore(el) {
    const ch = firstCharBeside(el, "before");
    return OPEN_BRACKETS.includes(ch) ? ch : "";
  }

  function bracketAfter(el) {
    const ch = firstCharBeside(el, "after");
    return CLOSE_BRACKETS.includes(ch) ? ch : "";
  }

  /**
   * 元メッセージのメンションを本文の出現順にトークン化する。
   * 自分宛（.mentionToMe）や重複も、かっこの受け渡しのためにトークンとして残し
   * excluded=true にしておく（「（@自分: @Bさん: ）」のような括りを崩さないため）。
   */
  function collectMentions(messageEl) {
    const seen = new Set();
    const tokens = [];
    for (const m of messageEl.querySelectorAll(SELECTORS.mention + ", " + SELECTORS.mentionToMe)) {
      // 末尾の ":"（半角/全角）は表示用なので除いて名前だけにする
      const name = (m.textContent || "").trim().replace(/[:：]\s*$/, "");
      if (!name.startsWith("@")) continue;
      const isMe = m.matches(SELECTORS.mentionToMe);
      tokens.push({
        name: name,
        open: bracketBefore(m),
        close: bracketAfter(m),
        excluded: isMe || seen.has(name),
      });
      seen.add(name);
    }
    return tokens;
  }

  /**
   * 挿入しないトークンが持っていたかっこを隣のトークンへ受け渡し、
   * 最後に対応の取れないかっこを取り除く。
   */
  function resolveBrackets(tokens) {
    const included = [];
    let carryOpen = "";
    for (const t of tokens) {
      if (t.excluded) {
        // 開きかっこは次に挿入するトークンへ、閉じかっこは直前に挿入したトークンへ
        if (t.open && !carryOpen) carryOpen = t.open;
        if (t.close && included.length > 0 && !included[included.length - 1].close) {
          included[included.length - 1].close = t.close;
        }
        continue;
      }
      const item = { name: t.name, open: t.open, close: t.close };
      if (!item.open && carryOpen) item.open = carryOpen;
      carryOpen = "";
      included.push(item);
    }

    // かっこの対応チェック（開き→閉じの順で種類が一致するものだけ残す）
    const stack = [];
    included.forEach((item, idx) => {
      if (item.open) stack.push({ idx: idx, ch: item.open });
      if (item.close) {
        const pair = OPEN_BRACKETS[CLOSE_BRACKETS.indexOf(item.close)];
        if (stack.length > 0 && stack[stack.length - 1].ch === pair) {
          stack.pop();
        } else {
          item.close = "";
        }
      }
    });
    for (const s of stack) included[s.idx].open = "";
    return included;
  }

  /** 挿入文字列。Stockのメンション記法 "@名前: " を崩さないよう、閉じかっこは ": " の後ろに置く */
  function formatMention(item) {
    return item.open + item.name + ": " + (item.close ? item.close + " " : "");
  }

  /** 入力欄へメンションを追記する（React管理のtextareaに対応） */
  function appendMentions(textarea, tokens) {
    let val = textarea.value;
    // 既に入力欄にある（=Stockが挿入した送信者など）メンションは挿入しない
    const marked = tokens.map((t) =>
      Object.assign({}, t, { excluded: t.excluded || val.includes(t.name) })
    );
    const additions = resolveBrackets(marked).map(formatMention);
    if (additions.length === 0) return;
    if (val && !/\s$/.test(val)) val += " ";
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    ).set;
    setter.call(textarea, val + additions.join(""));
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function onReplyClick(msg, room) {
    const mentions = collectMentions(msg);
    if (!mentions.some((t) => !t.excluded)) return;
    // Stockが "@送信者さん: " を挿入し終えるのを待ってから追記する
    setTimeout(() => {
      const textarea = room.querySelector("textarea");
      if (textarea) appendMentions(textarea, mentions);
    }, 600);
  }

  window.StockPlus.registerFeature({
    id: "reply-all-mentions",
    name: "全員に返信（メンション引き継ぎ）",
    init() {
      document.addEventListener(
        "click",
        (ev) => {
          if (!window.StockPlus.isCurrentInstance()) return;
          if (!window.StockPlus.isFeatureEnabled(SETTING_ID)) return;
          if (!(ev.target instanceof Element)) return;
          const btn = ev.target.closest(SELECTORS.toolBoxButtons);
          if (!btn || (btn.textContent || "").trim() !== SELECTORS.replyButtonText) {
            return;
          }
          const msg = btn.closest(SELECTORS.chatListItem);
          const room = btn.closest(SELECTORS.chatroom);
          if (msg && room) onReplyClick(msg, room);
        },
        true
      );
    },
  });
})();
