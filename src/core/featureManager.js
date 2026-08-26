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
