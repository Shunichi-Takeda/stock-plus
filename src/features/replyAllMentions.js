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
    // 他人宛メンション（自分宛は .mentionToMe で別クラス）
    mention: ".mention",
  };
  // ----------------------------------------------------------------------

  const SETTING_ID = "reply-all-mentions";

  const OPEN_BRACKETS = "（(「『【[｛{＜<";
  const CLOSE_BRACKETS = "）)」』】]｝}＞>";

  /** メンション要素の直前テキストの末尾が開きかっこならそれを返す */
  function bracketBefore(el) {
    const prev = el.previousSibling;
    const text = prev && prev.nodeType === 3 ? prev.textContent : "";
    const ch = text.slice(-1);
    return OPEN_BRACKETS.includes(ch) ? ch : "";
  }

  /** メンション要素の直後テキストの先頭が閉じかっこならそれを返す（":）"のような形も許容） */
  function bracketAfter(el) {
    const next = el.nextSibling;
    const text = next && next.nodeType === 3 ? next.textContent : "";
    const m = text.match(/^[:：]?(.)/);
    const ch = m ? m[1] : "";
    return CLOSE_BRACKETS.includes(ch) ? ch : "";
  }

  /**
   * 元メッセージから他人宛メンションを収集する。
   * 「（@xxx」「@xxx）」「（@xxx）」のように前後にかっこが付いている場合は
   * そのまま引き継ぐ。戻り値は {name, text}（name=重複判定用、text=挿入文字列）。
   */
  function collectMentions(messageEl) {
    const seen = new Set();
    const results = [];
    for (const m of messageEl.querySelectorAll(SELECTORS.mention)) {
      // 末尾の ":"（半角/全角）は表示用なので除いて名前だけにする
      const name = (m.textContent || "").trim().replace(/[:：]\s*$/, "");
      if (!name.startsWith("@") || seen.has(name)) continue;
      seen.add(name);
      const text = bracketBefore(m) + name + bracketAfter(m) + ": ";
      results.push({ name: name, text: text });
    }
    return results;
  }

  /** 入力欄へメンションを追記する（React管理のtextareaに対応） */
  function appendMentions(textarea, mentions) {
    let val = textarea.value;
    const additions = mentions
      .filter((m) => !val.includes(m.name))
      .map((m) => m.text);
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
    if (mentions.length === 0) return;
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
