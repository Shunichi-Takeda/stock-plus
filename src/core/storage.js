/**
 * Stock Plus - TTL付きlocalStorageラッパー
 *
 * ページ（stock-app.jp）のlocalStorageに保存する。
 * 各エントリは保存時刻を持ち、TTL（既定30日）を過ぎたものは
 * 読み出し時に自動的に間引かれる。
 */
(function () {
  "use strict";

  const NAMESPACE = "stockPlus";
  const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日 ≒ 1ヶ月

  class TtlStore {
    /**
     * @param {string} key ストア名（namespaceに連結される）
     * @param {number} [ttlMs] エントリの生存期間
     */
    constructor(key, ttlMs = DEFAULT_TTL_MS) {
      this.storageKey = `${NAMESPACE}.${key}`;
      this.ttlMs = ttlMs;
    }

    /** @returns {Array<object>} 期限内のエントリ一覧（savedAt昇順） */
    load() {
      let raw;
      try {
        raw = localStorage.getItem(this.storageKey);
      } catch (e) {
        return [];
      }
      if (!raw) return [];

      let entries;
      try {
        entries = JSON.parse(raw);
      } catch (e) {
        // 壊れたデータは捨てる
        this._save([]);
        return [];
      }
      if (!Array.isArray(entries)) return [];

      const now = Date.now();
      const alive = entries.filter(
        (e) => e && typeof e.savedAt === "number" && now - e.savedAt < this.ttlMs
      );
      if (alive.length !== entries.length) {
        this._save(alive);
      }
      return alive;
    }

    /**
     * エントリを追加する。dedupeKeyが一致する既存エントリは置き換える
     * （同じメッセージへの再返答は時刻を更新する扱い）。
     * @param {object} entry
     * @param {string} [dedupeKey] entry内の一意キーとなるプロパティ名
     */
    upsert(entry, dedupeKey) {
      const entries = this.load();
      const stamped = Object.assign({}, entry, { savedAt: Date.now() });
      let next = entries;
      if (dedupeKey && stamped[dedupeKey] != null) {
        next = entries.filter((e) => e[dedupeKey] !== stamped[dedupeKey]);
      }
      next.push(stamped);
      this._save(next);
      return stamped;
    }

    /** 全消去 */
    clear() {
      this._save([]);
    }

    _save(entries) {
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(entries));
      } catch (e) {
        // 容量超過等は握りつぶす（機能はベストエフォート）
      }
    }
  }

  window.StockPlus = window.StockPlus || {};
  window.StockPlus.TtlStore = TtlStore;
})();
