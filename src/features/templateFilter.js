/**
 * Stock Plus - 機能: テンプレート一覧の絞り込みフィルタ
 *
 * ノート作成時の「テンプレート一覧」モーダルに、テンプレート名で
 * 一覧を絞り込むテキストフィールドを追加する
 * （「テンプレート名」ヘッダーの右側に配置）。
 */
(function () {
  "use strict";

  // ---- チューニングポイント: Stock側のDOMに合わせて調整する場所 ----------
  const SELECTORS = {
    // テンプレート一覧
    list: "ul.templateList",
    // 一覧の行（ヘッダー行を含む）
    row: "li.templateListItem",
    headerRowClass: "templateListItem--header",
    // 名前セル（ヘッダー行では「テンプレート名」の見出しセル）
    nameCell: ".templateListItem__cell.nameCell",
  };
  // ----------------------------------------------------------------------

  const INPUT_CLASS = "stock-plus-template-filter";
  const HIDDEN_CLASS = "stock-plus-hidden";

  // モーダルが再描画されても入力中の絞り込みを維持するための保持変数
  let currentQuery = "";

  function normalize(s) {
    return (s || "").normalize("NFKC").toLowerCase().trim();
  }

  function applyFilter(list) {
    const query = normalize(currentQuery);
    for (const row of list.querySelectorAll(SELECTORS.row)) {
      if (row.classList.contains(SELECTORS.headerRowClass)) continue;
      const nameCell = row.querySelector(SELECTORS.nameCell);
      const name = normalize(nameCell ? nameCell.textContent : row.textContent);
      row.classList.toggle(HIDDEN_CLASS, query !== "" && !name.includes(query));
    }
  }

  function ensureFilterInput() {
    const list = document.querySelector(SELECTORS.list);
    if (!list) {
      currentQuery = ""; // モーダルが閉じたら絞り込みをリセット
      return;
    }
    const headerNameCell = list.querySelector(
      SELECTORS.row + "." + SELECTORS.headerRowClass + " " + SELECTORS.nameCell
    );
    if (!headerNameCell) return;

    const existing = headerNameCell.querySelector("." + INPUT_CLASS);
    if (existing) {
      if (existing.dataset.stockPlusInstance === window.StockPlus.instanceId) {
        return;
      }
      existing.remove(); // 旧インスタンスの入力欄は作り直す
    }

    const input = document.createElement("input");
    input.type = "text";
    input.className = INPUT_CLASS;
    input.placeholder = "絞り込み";
    input.value = currentQuery;
    input.dataset.stockPlusInstance = window.StockPlus.instanceId;
    // Stock側のモーダルにキー・クリックイベントを渡さない
    input.addEventListener("click", (ev) => ev.stopPropagation());
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") ev.preventDefault();
    });
    input.addEventListener("input", () => {
      currentQuery = input.value;
      applyFilter(list);
    });

    headerNameCell.appendChild(input);
    if (currentQuery) applyFilter(list);
  }

  let timer = null;

  function scheduleRefresh() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!window.StockPlus.isCurrentInstance()) return;
      ensureFilterInput();
    }, 200);
  }

  window.StockPlus.registerFeature({
    id: "template-filter",
    name: "テンプレート一覧の絞り込みフィルタ",
    init() {
      const observer = new MutationObserver(() => scheduleRefresh());
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleRefresh();
    },
  });
})();
