/**
 * Stock Plus - 機能: 大人数チャットの送信確認（二段構え）
 *
 * 参加者が10名以上のチャットで、入力欄に @メンションが1つも無い、または
 * @All が含まれている場合、「送信」ボタンを赤い「確認」ボタンに差し替える。
 * 「確認」を押すと通常の「送信」ボタンに戻り（確認済み状態）、もう一度押すと
 * 普通に送信される。メンション無しや @All で大人数へ誤って一斉送信するのを防ぐ。
 *
 *  - キーボード送信も同様に1回目は確認扱いにする。送信キー（Enter / Shift+Enter /
 *    Ctrl+Enter）はStockの設定で変わるため、送信ボタンのツールチップから判定する
 *  - しきい値（参加人数）は設定画面で変更できる（デフォルト10名）
 *  - 送信が完了して入力欄が空になる、または条件を満たさなくなったら確認済み状態を解除
 *  - 10名未満のチャットや、個人宛メンションがある場合は何もしない
 */
(function () {
  "use strict";

  // ---- チューニングポイント: Stock側のDOMに合わせて調整する場所 ----------
  const SELECTORS = {
    chatroom: ".chatroom",
    // 参加人数（「26人」のようなテキスト）
    memberCount: ".chatroom__membersBox__count",
    sendButton: ".chatroom__toolBar__sendBtn",
    composer: "textarea",
    // 送信ボタンにホバーすると出るツールチップ（「Shift + Enterで送信」等）
    sendTooltip: ".SendButtonTooltip",
  };
  // ----------------------------------------------------------------------

  const SETTING_ID = "send-confirm";
  const OPTION_THRESHOLD = "sendConfirmThreshold";
  const DEFAULT_MIN_MEMBERS = 10;

  /** 確認を要する参加人数のしきい値（設定画面で変更可能。デフォルト10名） */
  function minMembers() {
    const n = parseInt(window.StockPlus.getOption(OPTION_THRESHOLD, DEFAULT_MIN_MEMBERS), 10);
    return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MIN_MEMBERS;
  }
  const CONFIRM_CLASS = "stock-plus-send-confirm";
  // 「確認」→「送信」に切り替わった瞬間のエフェクト用（アニメーション終了で外す）
  const ARMED_ANIM_CLASS = "stock-plus-send-armed";
  // 「確認」を押して送信可能になった状態（送信するまで保持）
  const armed = new WeakSet();

  function memberCount(room) {
    const el = room.querySelector(SELECTORS.memberCount);
    const m = el && (el.textContent || "").match(/\d+/);
    return m ? parseInt(m[0], 10) : 0;
  }

  /** このチャットの入力内容が「確認」を要する状態か */
  function needsConfirm(room) {
    if (memberCount(room) < minMembers()) return false;
    const composer = room.querySelector(SELECTORS.composer);
    const text = composer ? composer.value : "";
    if (!text.trim()) return false;
    const hasMention = /@\S/.test(text);
    const hasAll = /@All(?![A-Za-z0-9_])/.test(text);
    return !hasMention || hasAll;
  }

  function refreshRoom(room) {
    const btn = room.querySelector(SELECTORS.sendButton);
    if (!btn) return;
    const composer = room.querySelector(SELECTORS.composer);
    // 送信して空になった / 条件を満たさなくなったら確認済み状態を解除
    if (!composer || !composer.value.trim() || !needsConfirm(room)) {
      armed.delete(room);
    }
    const showConfirm = needsConfirm(room) && !armed.has(room);
    btn.classList.toggle(CONFIRM_CLASS, showConfirm);
    const title = showConfirm
      ? `${minMembers()}名以上のチャットにメンション無し（または@All）で送信しようとしています。もう一度押すと送信ボタンに戻ります（Stock Plus）`
      : "";
    if (btn.title !== title) btn.title = title;
  }

  function refreshAll() {
    document.querySelectorAll(SELECTORS.chatroom).forEach(refreshRoom);
  }

  function removeAll() {
    document
      .querySelectorAll("." + CONFIRM_CLASS)
      .forEach((btn) => {
        btn.classList.remove(CONFIRM_CLASS);
        btn.title = "";
      });
  }

  /** 「送信」に切り替わったことが分かるよう、ボタンを一瞬ふくらませて光らせる */
  function playArmedEffect(btn) {
    if (!btn) return;
    btn.classList.remove(ARMED_ANIM_CLASS);
    void btn.offsetWidth; // 連続クリック時にもアニメーションを最初から再生させる
    btn.classList.add(ARMED_ANIM_CLASS);
    const done = () => btn.classList.remove(ARMED_ANIM_CLASS);
    btn.addEventListener("animationend", done, { once: true });
    setTimeout(done, 1000); // animationendが来ない場合の保険
  }

  /** 送信操作を横取りして、1回目は「確認」として扱う。横取りしたらtrue */
  function interceptIfNeeded(room, ev) {
    if (!needsConfirm(room) || armed.has(room)) return false;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    armed.add(room);
    refreshRoom(room);
    playArmedEffect(room.querySelector(SELECTORS.sendButton));
    return true;
  }

  // ---- 送信キーの判定 ------------------------------------------------------
  // Stockは設定で送信キーを変えられる（Enter / Shift+Enter / Ctrl(⌘)+Enter）。
  // 設定値はDOMに無いが、送信ボタンのツールチップ「〜で送信」に現れるので、
  // 最初にチャットが開いたときに一度だけホバーを模擬して読み取る。
  let sendKeyMode = null; // "enter" | "shift" | "mod"

  function parseSendKeyMode(text) {
    if (!text || !/Enter/i.test(text)) return null;
    if (/Shift/i.test(text)) return "shift";
    if (/Ctrl|Cmd|Command|⌘|Control/i.test(text)) return "mod";
    return "enter";
  }

  let detecting = false;
  function detectSendKeyMode(room) {
    if (sendKeyMode || detecting) return;
    const btn = room.querySelector(SELECTORS.sendButton);
    if (!btn) return;
    detecting = true;
    btn.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    btn.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    setTimeout(() => {
      const tip = document.querySelector(SELECTORS.sendTooltip);
      sendKeyMode = parseSendKeyMode(tip ? tip.textContent : "");
      btn.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      btn.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
      detecting = false;
      if (sendKeyMode) window.StockPlus.sendKeyMode = sendKeyMode;
    }, 250);
  }

  /** このEnterキー操作が、現在の設定で「送信」になるか */
  function isSendKey(ev) {
    if (ev.key !== "Enter" || ev.isComposing) return false;
    const mod = ev.metaKey || ev.ctrlKey;
    switch (sendKeyMode || "enter") {
      case "shift":
        return ev.shiftKey && !mod;
      case "mod":
        return mod;
      default:
        return !ev.shiftKey && !mod;
    }
  }

  function isEnabled() {
    return (
      window.StockPlus.isCurrentInstance() &&
      window.StockPlus.isFeatureEnabled(SETTING_ID)
    );
  }

  let timer = null;

  function scheduleRefresh() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!window.StockPlus.isCurrentInstance()) return;
      if (!window.StockPlus.isFeatureEnabled(SETTING_ID)) {
        removeAll();
        return;
      }
      refreshAll();
      const room = document.querySelector(SELECTORS.chatroom);
      if (room) detectSendKeyMode(room);
    }, 150);
  }

  window.StockPlus.registerFeature({
    id: "send-confirm",
    name: "大人数チャットの送信確認",
    init() {
      // 送信ボタンのクリック（Stock側のハンドラより先に動くようcapture）
      document.addEventListener(
        "click",
        (ev) => {
          if (!isEnabled() || !(ev.target instanceof Element)) return;
          const btn = ev.target.closest(SELECTORS.sendButton);
          const room = btn && btn.closest(SELECTORS.chatroom);
          if (room) interceptIfNeeded(room, ev);
        },
        true
      );

      // キーボードでの送信（送信キーの設定に合わせて判定。改行用のEnterは妨げない）
      document.addEventListener(
        "keydown",
        (ev) => {
          if (!isEnabled()) return;
          if (!isSendKey(ev)) return;
          const target = ev.target;
          if (!(target instanceof Element) || !target.matches(SELECTORS.composer)) return;
          const room = target.closest(SELECTORS.chatroom);
          if (room) interceptIfNeeded(room, ev);
        },
        true
      );

      // 入力内容の変化に追従（メンションの有無で確認要否が変わる）
      document.addEventListener("input", (ev) => {
        if (ev.target instanceof Element && ev.target.matches(SELECTORS.composer)) {
          scheduleRefresh();
        }
      }, true);

      const observer = new MutationObserver(() => scheduleRefresh());
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleRefresh();
    },
    refresh: scheduleRefresh,
  });
})();
