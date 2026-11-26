/**
 * Stock Plus - 機能: 「ノートだけ既読」（設定の橋渡し）
 *
 * 本体は markNoteRead.main.js（ページ側 = world: "MAIN" で動く）。
 * ページ側からは chrome.storage を読めないため、このファイル（通常の content script）が
 * 機能のON/OFFを <html> の属性に書き出して渡す。
 *   data-stock-plus-note-read="on|off"
 */
(function () {
  "use strict";

  const SETTING_ID = "mark-note-read";

  function apply() {
    if (!window.StockPlus.isCurrentInstance()) return;
    const enabled = window.StockPlus.isFeatureEnabled(SETTING_ID);
    document.documentElement.setAttribute("data-stock-plus-note-read", enabled ? "on" : "off");
  }

  window.StockPlus.registerFeature({
    id: SETTING_ID,
    name: "「ノートだけ既読」",
    init: apply,
    refresh: apply,
  });
})();
