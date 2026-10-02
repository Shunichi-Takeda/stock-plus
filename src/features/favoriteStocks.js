/**
 * Stock Plus - 機能: お気に入りの記事
 *
 *  - 記事（ノート）ページ右上の「設定（⚙）」の左隣に ★ ボタンを追加し、
 *    お気に入りのON/OFFを切り替える
 *  - 左メニューの「新着ノート」の下に「お気に入りの記事」リンクを追加
 *  - リンクを選ぶと、記事一覧の欄をフォルダ名「お気に入りの記事」として、
 *    お気に入り登録した記事の一覧に差し替えて表示する（仮想フォルダ）
 *
 * お気に入りはlocalStorageにチーム別で保存する（期限なし。拡張を入れ直しても残る）。
 * セレクタは実際のStock（stock-app.jp）のDOM（2026-10確認）に合わせてある。
 */
(function () {
  "use strict";

  // ---- チューニングポイント: Stock側のDOMに合わせて調整する場所 ----------
  const SELECTORS = {
    // 記事ページのヘッダー（フォルダ / タグ / タスク設定 / ⚙）
    stockHeader: ".stockHeader",
    // ⚙ のエリア（この左隣に★を入れる）
    configBtnArea: ".stockHeader__configBtnArea",
    // 記事タイトル入力欄
    titleInput: '.stockPage [placeholder="タイトル（任意）"]',
    // 記事の所属フォルダ名（ヘッダーのフォルダ変更ボタン）
    changeGroupBtn: ".stockHeader .changeGroupBtn",
    // 左メニュー
    groupsBody: ".groupsBody",
    allStocksLink: ".groupsBody > a.allStocksLnk",
    // 記事一覧の欄（ヘッダー + 一覧）
    stocksContent: ".stocksContent",
  };
  // ----------------------------------------------------------------------

  const SETTING_ID = "favorite-stocks";
  const STORAGE_KEY = "stockPlus.favoriteStocks";
  const FAV_MODE_CLASS = "stock-plus-fav-mode";
  const STAR_AREA_CLASS = "stock-plus-fav-area";
  const LINK_CLASS = "stock-plus-fav-lnk";
  const PANEL_CLASS = "stock-plus-fav-panel";

  // FontAwesome（solid）の star。Stockのアイコンと同じ系統
  const STAR_SVG =
    '<svg viewBox="0 0 576 512" width="16" height="16" fill="currentColor" aria-hidden="true">' +
    '<path d="M259.3 17.8L194 150.2 47.9 171.5c-26.2 3.8-36.7 36.1-17.7 54.6l105.7 103-25 145.5c-4.5 26.3 23.2 46 46.4 33.7L288 439.6l130.7 68.7c23.2 12.2 50.9-7.4 46.4-33.7l-25-145.5 105.7-103c19-18.5 8.5-50.8-17.7-54.6L382 150.2 316.7 17.8c-11.7-23.6-45.6-23.9-57.4 0z"/>' +
    "</svg>";

  // 「お気に入りの記事」表示中か
  let favMode = false;

  // ---- 保存データ ------------------------------------------------------------

  function loadAll() {
    try {
      const list = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function saveAll(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
      // 容量超過等は握りつぶす（機能はベストエフォート）
    }
  }

  /** 現在のチームのお気に入り（登録が新しい順） */
  function teamFavorites() {
    const team = currentRoute().team;
    return loadAll()
      .filter((f) => f.team === team)
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  function isFavorite(team, stockId) {
    return loadAll().some((f) => f.team === team && f.stockId === stockId);
  }

  // ---- ルーティング ----------------------------------------------------------

  /** URLからチーム・記事IDを取り出す */
  function currentRoute() {
    const m = location.pathname.match(
      /^\/teams\/([^/]+)\/dashboard(?:\/([^/]+)\/stocks(?:\/(\d+))?)?/
    );
    return {
      team: m ? m[1] : "",
      folder: m && m[2] ? m[2] : "",
      stockId: m && m[3] ? m[3] : "",
    };
  }

  function stockPath(team, stockId) {
    return `/teams/${team}/dashboard/all/stocks/${stockId}/edit`;
  }

  /** StockのSPAルーター（History API）に乗せて画面遷移する（ページ再読込なし） */
  function navigate(path) {
    if (location.pathname === path) return;
    history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }

  // ---- 記事ページの★ボタン ----------------------------------------------------

  /** 開いている記事のタイトル・フォルダ名 */
  function currentStockInfo() {
    const titleEl = document.querySelector(SELECTORS.titleInput);
    const title =
      (titleEl && (titleEl.value || titleEl.textContent || "").trim()) ||
      document.title.replace(/^\[\d+\]/, "").trim();
    const groupBtn = document.querySelector(SELECTORS.changeGroupBtn);
    const groupName = groupBtn ? (groupBtn.textContent || "").trim() : "";
    return { title, groupName };
  }

  function toggleFavorite() {
    const { team, stockId } = currentRoute();
    if (!team || !stockId) return;
    const list = loadAll();
    const idx = list.findIndex((f) => f.team === team && f.stockId === stockId);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      const info = currentStockInfo();
      list.push({
        team,
        stockId,
        title: info.title,
        groupName: info.groupName,
        savedAt: Date.now(),
      });
    }
    saveAll(list);
    scheduleRefresh();
  }

  /** お気に入り済み記事のタイトル・フォルダ名が変わっていたら保存値を更新する */
  function syncCurrentStockInfo(team, stockId) {
    const list = loadAll();
    const fav = list.find((f) => f.team === team && f.stockId === stockId);
    if (!fav) return;
    const info = currentStockInfo();
    if (
      (info.title && info.title !== fav.title) ||
      (info.groupName && info.groupName !== fav.groupName)
    ) {
      fav.title = info.title || fav.title;
      fav.groupName = info.groupName || fav.groupName;
      saveAll(list);
    }
  }

  function ensureStarButton() {
    const header = document.querySelector(SELECTORS.stockHeader);
    const { team, stockId } = currentRoute();
    let area = document.querySelector("." + STAR_AREA_CLASS);
    if (!header || !stockId) {
      if (area) area.remove();
      return;
    }
    const configArea = header.querySelector(SELECTORS.configBtnArea);
    if (!configArea) return;

    // 旧インスタンスのボタン（ハンドラが無効）や、位置がずれたものは作り直す
    if (
      area &&
      (area.dataset.stockPlusInstance !== window.StockPlus.instanceId ||
        area.nextElementSibling !== configArea)
    ) {
      area.remove();
      area = null;
    }
    if (!area) {
      area = document.createElement("div");
      area.className = STAR_AREA_CLASS;
      area.dataset.stockPlusInstance = window.StockPlus.instanceId;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "stock-plus-fav-btn";
      btn.innerHTML = STAR_SVG;
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        toggleFavorite();
      });
      area.appendChild(btn);
      configArea.insertAdjacentElement("beforebegin", area);
    }

    syncCurrentStockInfo(team, stockId);
    const on = isFavorite(team, stockId);
    const btn = area.querySelector("button");
    btn.classList.toggle("active", on);
    const label = on ? "お気に入りから外す（Stock Plus）" : "お気に入りに追加（Stock Plus）";
    if (btn.title !== label) btn.title = label;
  }

  // ---- 左メニューの「お気に入りの記事」リンク ---------------------------------

  function ensureMenuLink() {
    const allLink = document.querySelector(SELECTORS.allStocksLink);
    let link = document.querySelector("." + LINK_CLASS);
    if (!allLink) return;

    if (
      link &&
      (link.dataset.stockPlusInstance !== window.StockPlus.instanceId ||
        link.previousElementSibling !== allLink)
    ) {
      link.remove();
      link = null;
    }
    if (!link) {
      link = document.createElement("a");
      // Stockの「新着ノート」と同じ見た目にするため allStocksLnk を流用
      link.className = "allStocksLnk " + LINK_CLASS;
      link.href = "#";
      link.dataset.stockPlusInstance = window.StockPlus.instanceId;
      const label = document.createElement("span");
      label.textContent = "お気に入りの記事";
      const count = document.createElement("span");
      count.className = "allStocksLnk__unreadCount stock-plus-fav-count";
      link.appendChild(label);
      link.appendChild(count);
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        enterFavMode();
      });
      allLink.insertAdjacentElement("afterend", link);
    }

    const n = teamFavorites().length;
    const countText = n > 0 ? `(${n})` : "";
    const countEl = link.querySelector(".stock-plus-fav-count");
    if (countEl.textContent !== countText) countEl.textContent = countText;
    link.classList.toggle("isSelected", favMode);
  }

  // ---- 「お気に入りの記事」一覧（仮想フォルダ） -------------------------------

  function enterFavMode() {
    const { team, stockId } = currentRoute();
    if (!team) return;
    favMode = true;
    // 記事一覧の欄がある画面（/all/）へ。開いている記事があれば開いたままにする
    navigate(
      stockId ? stockPath(team, stockId) : `/teams/${team}/dashboard/all/stocks`
    );
    scheduleRefresh();
  }

  function exitFavMode() {
    if (!favMode) return;
    favMode = false;
    scheduleRefresh();
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  }

  function buildItem(fav, selectedId) {
    const li = document.createElement("li");
    li.className = "stockListItem" + (fav.stockId === selectedId ? " isSelected" : "");

    const a = document.createElement("a");
    a.className = "stockListItem__lnkArea";
    a.href = stockPath(fav.team, fav.stockId);
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      navigate(stockPath(fav.team, fav.stockId));
    });

    const area = document.createElement("div");
    area.className = "stockListItem__stockArea";

    if (fav.groupName) {
      const groupBox = document.createElement("div");
      groupBox.className = "stockListItem__groupNameBox";
      const g = document.createElement("span");
      g.className = "stockListItem__groupNameBox__groupName";
      g.textContent = fav.groupName;
      groupBox.appendChild(g);
      area.appendChild(groupBox);
    }

    const titleBox = document.createElement("div");
    titleBox.className = "stockListItem__titleBox";
    const t = document.createElement("span");
    t.className = "stockListItem__titleBox__title";
    t.textContent = fav.title || "(タイトルなし)";
    titleBox.appendChild(t);
    area.appendChild(titleBox);

    const meta = document.createElement("div");
    meta.className = "stock-plus-fav-meta";
    meta.textContent = `${formatDate(fav.savedAt)} にお気に入り登録`;
    area.appendChild(meta);

    a.appendChild(area);
    li.appendChild(a);

    // 一覧からもお気に入りを外せるようにする
    const unfav = document.createElement("button");
    unfav.type = "button";
    unfav.className = "stock-plus-fav-btn stock-plus-fav-item-btn active";
    unfav.title = "お気に入りから外す（Stock Plus）";
    unfav.innerHTML = STAR_SVG;
    unfav.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      saveAll(
        loadAll().filter((f) => !(f.team === fav.team && f.stockId === fav.stockId))
      );
      scheduleRefresh();
    });
    li.appendChild(unfav);
    return li;
  }

  function ensureFavPanel() {
    const content = document.querySelector(SELECTORS.stocksContent);
    let panel = document.querySelector("." + PANEL_CLASS);
    if (!favMode || !content) {
      if (panel) panel.remove();
      return;
    }

    const favs = teamFavorites();
    const selectedId = currentRoute().stockId;
    // 自分のDOM更新でオブザーバが再発火しても作り直さないよう、内容が変わったときだけ描画する
    const signature = JSON.stringify([window.StockPlus.instanceId, selectedId, favs]);
    if (panel && panel.parentElement === content && panel.dataset.signature === signature) {
      return;
    }
    if (panel) panel.remove();

    panel = document.createElement("div");
    panel.className = PANEL_CLASS;
    panel.dataset.signature = signature;

    // ヘッダー（Stockのフォルダ見出しと同じクラスで見た目を揃える）
    const header = document.createElement("div");
    header.className = "stocksHeader";
    header.innerHTML =
      '<div class="stocksHeaderBox"><div class="stocksHeaderBox__groupNameArea--uneditable">' +
      '<div class="groupNameBox"><p class="groupName"></p></div></div></div>';
    header.querySelector(".groupName").textContent = "お気に入りの記事";
    panel.appendChild(header);

    const listWrap = document.createElement("div");
    listWrap.className = "stockList stock-plus-fav-list";
    if (favs.length === 0) {
      const empty = document.createElement("p");
      empty.className = "stock-plus-fav-empty";
      empty.textContent =
        "お気に入りの記事はまだありません。記事の右上の ★ から登録できます。";
      listWrap.appendChild(empty);
    } else {
      const ul = document.createElement("ul");
      for (const fav of favs) ul.appendChild(buildItem(fav, selectedId));
      listWrap.appendChild(ul);
    }
    panel.appendChild(listWrap);
    content.appendChild(panel);
  }

  function initModeExit() {
    // 左メニューで他のリンク（新着ノート・フォルダ等）を選んだら仮想フォルダを抜ける
    document.addEventListener(
      "click",
      (ev) => {
        if (!favMode || !window.StockPlus.isCurrentInstance()) return;
        if (!(ev.target instanceof Element)) return;
        const inMenu = ev.target.closest(SELECTORS.groupsBody);
        if (inMenu && !ev.target.closest("." + LINK_CLASS)) exitFavMode();
      },
      true
    );
  }

  // ---- 全体の更新 ------------------------------------------------------------

  function removeAll() {
    favMode = false;
    document.documentElement.classList.remove(FAV_MODE_CLASS);
    document
      .querySelectorAll(`.${STAR_AREA_CLASS}, .${LINK_CLASS}, .${PANEL_CLASS}`)
      .forEach((el) => el.remove());
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
      // /all/ 以外へ移動した（検索・メッセージのリンク等）ら仮想フォルダを抜ける
      if (favMode && currentRoute().folder !== "all") favMode = false;
      document.documentElement.classList.toggle(FAV_MODE_CLASS, favMode);
      ensureStarButton();
      ensureMenuLink();
      ensureFavPanel();
    }, 200);
  }

  window.StockPlus.registerFeature({
    id: "favorite-stocks",
    name: "お気に入りの記事",
    init() {
      initModeExit();
      const observer = new MutationObserver(() => scheduleRefresh());
      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("popstate", () => scheduleRefresh());
      scheduleRefresh();
    },
    refresh: scheduleRefresh,
  });
})();
