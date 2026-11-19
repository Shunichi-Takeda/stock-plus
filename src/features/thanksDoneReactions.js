/**
 * Stock Plus - 機能: 「ありがとう」「完了しました」リアクション（設定の橋渡し）
 *
 * 本体は thanksDoneReactions.main.js（ページ側 = world: "MAIN" で動く）。
 * ページ側からは chrome.storage を読めないため、このファイル（通常の content script）が
 * 機能のON/OFFとオプションを <html> の属性に書き出して渡す。
 *   data-stock-plus-reactions="on|off"
 *   data-stock-plus-reactions-hide-unread="on|off"
 */
(function () {
  "use strict";

  const SETTING_ID = "thanks-done-reactions";
  // 設定画面のオプション: 操作ボタン列の「未読に戻す」を隠す（デフォルトON）
  const OPTION_HIDE_UNREAD = "reactionsHideUnread";

  function apply() {
    if (!window.StockPlus.isCurrentInstance()) return;
    const root = document.documentElement;
    const enabled = window.StockPlus.isFeatureEnabled(SETTING_ID);
    const hideUnread = window.StockPlus.getOption(OPTION_HIDE_UNREAD, true) !== false;
    root.setAttribute("data-stock-plus-reactions", enabled ? "on" : "off");
    root.setAttribute("data-stock-plus-reactions-hide-unread", hideUnread ? "on" : "off");
  }

  window.StockPlus.registerFeature({
    id: SETTING_ID,
    name: "「ありがとう」「完了しました」リアクション",
    init: apply,
    refresh: apply,
  });
})();
