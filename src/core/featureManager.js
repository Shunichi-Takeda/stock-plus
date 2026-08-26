/**
 * Stock Plus - 機能マネージャ
 *
 * Stock Plusは「Stockを拡張するツールキット」として、
 * 個々の機能をfeatureモジュールとして登録・起動する。
 * 新機能を追加するときは src/features/ にファイルを置き、
 * StockPlus.registerFeature({...}) を呼ぶだけでよい。
 */
(function () {
  "use strict";

  window.StockPlus = window.StockPlus || {};
  const features = [];

  /**
   * インスタンスガード:
   * 拡張を再読み込みすると、ページをリロードするまで古いcontent scriptが
   * ページ内に残留し（オーファン化）、新旧インスタンスが二重に動作して
   * 互いのDOM操作を打ち消し合う。これを防ぐため、最後に読み込まれた
   * インスタンスのIDをDOMに記録し、各インスタンスは自分が最新のときだけ
   * 動作する。
   */
  const INSTANCE_ID = Date.now() + "-" + Math.random().toString(36).slice(2);
  document.documentElement.setAttribute("data-stock-plus-instance", INSTANCE_ID);
  window.StockPlus.instanceId = INSTANCE_ID;
  window.StockPlus.isCurrentInstance = function () {
    return (
      document.documentElement.getAttribute("data-stock-plus-instance") ===
      INSTANCE_ID
    );
  };

  /**
   * @param {{id: string, name: string, init: () => void}} feature
   */
  window.StockPlus.registerFeature = function (feature) {
    features.push(feature);
  };

  window.StockPlus.startAll = function () {
    for (const f of features) {
      try {
        f.init();
        console.info(`[Stock Plus] feature "${f.id}" started`);
      } catch (e) {
        console.error(`[Stock Plus] feature "${f.id}" failed to start`, e);
      }
    }
  };
})();
