/**
 * Stock Plus - 共通ユーティリティ
 */
(function () {
  "use strict";

  window.StockPlus = window.StockPlus || {};

  /**
   * 名前の照合キー。以下のゆらぎを吸収して比較する:
   *  - NBSP・全角/半角・連続空白の差異（一覧とチャットで空白文字が異なる）
   *  - 「【〇】→【済】」のような状態プレフィックスの付け替え（ノート改名）
   *  - 「飛田（とびた）悠太」→「飛田悠太」のようなかっこ書きの増減
   */
  window.StockPlus.matchKey = function (s) {
    return (s || "")
      .normalize("NFKC")
      .replace(/【[^】]*】/g, "")
      .replace(/[（(][^）)]*[）)]/g, "")
      .replace(/\s+/g, "")
      .toLowerCase();
  };
})();
