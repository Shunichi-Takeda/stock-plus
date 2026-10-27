/**
 * Stock Plus - エントリポイント
 * 機能ON/OFF設定を読み込んでから全featureを起動する。
 */
(function () {
  "use strict";
  if (!window.StockPlus) return;

  function start() {
    window.StockPlus.startAll();
  }

  try {
    chrome.storage.sync.get({ featureSettings: {}, featureOptions: {} }, (res) => {
      window.StockPlus.settings = res.featureSettings || {};
      window.StockPlus.options = res.featureOptions || {};
      start();

      // popupでの設定変更を即時反映する
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "sync") return;
        if (changes.featureSettings) {
          window.StockPlus.settings = changes.featureSettings.newValue || {};
        }
        if (changes.featureOptions) {
          window.StockPlus.options = changes.featureOptions.newValue || {};
        }
        if (changes.featureSettings || changes.featureOptions) {
          window.StockPlus.refreshAll();
        }
      });
    });
  } catch (e) {
    // storageが使えない場合は全機能ON（デフォルト）で起動
    start();
  }
})();
