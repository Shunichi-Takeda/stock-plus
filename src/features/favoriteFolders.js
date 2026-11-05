/**
 * Stock Plus - 機能: お気に入りのフォルダ
 *
 * 「お気に入りの記事」（favoriteStocks.js）と同じ作りのフォルダ版。
 *  - 左メニューの各フォルダ行（親フォルダの中のフォルダ）にマウスを乗せると、
 *    右端に ★ ボタンが出て、お気に入りのON/OFFを切り替えられる
 *  - ノート一覧（第二カラム）のフォルダ名の右、⚙ の左隣にも ★ ボタンを出し、
 *    開いているフォルダのお気に入りを切り替えられる
 *  - 左メニューの「お気に入りの記事」の下に「お気に入りのフォルダ」リンクを追加
 *  - リンクを選ぶと、ノート一覧の欄をフォルダ名「お気に入りのフォルダ」として、
 *    お気に入り登録したフォルダの一覧（親フォルダ名付き）に差し替えて表示する
 *  - 一覧のフォルダを選ぶと、そのフォルダのノート一覧を開く（ページ再読込なし）
 *
 * 親フォルダ（⚙付きの開閉するだけの行）は対象外。
 * お気に入りはlocalStorageにチーム別で保存する（期限なし。拡張を入れ直しても残る）。
 * セレクタは実際のStock（stock-app.jp）のDOM（2026-11確認）に合わせてある。
 */
(function () {
  "use strict";

  // ---- チューニングポイント: Stock側のDOMに合わせて調整する場所 ----------
  const SELECTORS = {
    groupsBody: ".groupsBody",
    groupCollectionList: ".groupsBody > ul.groupCollectionList",
    // 左メニューの「新着ノート」と、「お気に入りの記事」（favoriteStocks.js が追加）
    allStocksLink: ".groupsBody > a.allStocksLnk:not([class*='stock-plus-'])",
    favStocksLink: ".groupsBody > a.stock-plus-fav-lnk",
    // フォルダ行とリンク・名前・未読数
    folderItem: "li.groupListItem",
    folderLink: "a.groupBoxLnk",
    folderName: ".groupBoxLnk__name > span:first-child",
    folderCount: ".groupBoxLnk__name__count",
    // 親フォルダの行と名前
    parentItem: ".groupCollectionListItem",
    parentName: ".groupCollectionBox__name > span:first-child",
    // ノート一覧（第二カラム）と、そのフォルダ見出し（自前の見出しは含まない）
    stocksContent: ".stocksContent",
    listHeaderNameBox: ".stocksContent > .stocksHeader .groupNameBox",
    listHeaderName: ".groupName__text",
    listHeaderConfig: ".groupConfigDropdown",
  };
  // ----------------------------------------------------------------------

  const SETTING_ID = "favorite-folders";
  const STORAGE_KEY = "stockPlus.favoriteFolders";
  const MODE_CLASS = "stock-plus-favfolder-mode";
  const ROW_BTN_CLASS = "stock-plus-favfolder-btn";
  const HEADER_BTN_CLASS = "stock-plus-favfolder-header-btn";
  const LINK_CLASS = "stock-plus-favfolder-lnk";
  const PANEL_CLASS = "stock-plus-favfolder-panel";

  const STAR_SVG =
    '<svg viewBox="0 0 576 512" width="12" height="12" fill="currentColor" aria-hidden="true">' +
    '<path d="M259.3 17.8L194 150.2 47.9 171.5c-26.2 3.8-36.7 36.1-17.7 54.6l105.7 103-25 145.5c-4.5 26.3 23.2 46 46.4 33.7L288 439.6l130.7 68.7c23.2 12.2 50.9-7.4 46.4-33.7l-25-145.5 105.7-103c19-18.5 8.5-50.8-17.7-54.6L382 150.2 316.7 17.8c-11.7-23.6-45.6-23.9-57.4 0z"/>' +
    "</svg>";

  // 「お気に入りのフォルダ」表示中なら、表示を始めた時のURL（URLが変わったら抜ける）
  let modePath = null;

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

  /** 現在のチームのお気に入り（登録が新しい順。「お気に入りの記事」と同じ） */
  function teamFavorites(team) {
    return loadAll()
      .filter((f) => f.team === team)
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  // ---- ルーティング ----------------------------------------------------------

  function currentRoute() {
    const m = location.pathname.match(/^\/teams\/([^/]+)\/dashboard(?:\/([^/]+))?/);
    return { team: m ? m[1] : "", folder: m && m[2] ? m[2] : "" };
  }

  function folderPath(team, folderId) {
    return `/teams/${team}/dashboard/${folderId}/stocks`;
  }

  /** フォルダリンクのhrefからフォルダIDを取り出す */
  function folderIdOf(link) {
    const m = (link.getAttribute("href") || "").match(/\/dashboard\/(\d+)\/stocks/);
    return m ? m[1] : "";
  }

  /** StockのSPAルーター（History API）に乗せて画面遷移する（ページ再読込なし） */
  function navigate(path) {
    if (location.pathname === path) return;
    history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state: {} }));
  }

  // ---- Stock本来のフォルダ行 --------------------------------------------------

  /** 左メニューに描画されているフォルダ行を {id: 情報} で返す */
  function collectFolderRows() {
    const rows = {};
    document
      .querySelectorAll(`${SELECTORS.groupCollectionList} ${SELECTORS.folderItem}`)
      .forEach((li) => {
        const link = li.querySelector(SELECTORS.folderLink);
        if (!link) return;
        const id = folderIdOf(link);
        if (!id) return;
        const nameEl = li.querySelector(SELECTORS.folderName);
        const countEl = li.querySelector(SELECTORS.folderCount);
        const parent = li.closest(SELECTORS.parentItem);
        const parentNameEl = parent && parent.querySelector(SELECTORS.parentName);
        rows[id] = {
          li,
          link,
          name: nameEl ? nameEl.textContent.trim() : link.textContent.trim(),
          parentName: parentNameEl ? parentNameEl.textContent.trim() : "",
          count: countEl ? countEl.textContent.trim() : "",
        };
      });
    return rows;
  }

  function toggleFavorite(team, folderId, row) {
    const list = loadAll();
    const idx = list.findIndex((f) => f.team === team && f.folderId === folderId);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.push({
        team,
        folderId,
        name: row ? row.name : "",
        parentName: row ? row.parentName : "",
        savedAt: Date.now(),
      });
    }
    saveAll(list);
    scheduleRefresh();
  }

  /** フォルダ名・親フォルダ名が変わっていたら保存値を更新する（表示されている行のみ） */
  function syncNames(team, rows) {
    const list = loadAll();
    let changed = false;
    for (const f of list) {
      if (f.team !== team) continue;
      const row = rows[f.folderId];
      if (!row) continue;
      if (row.name && row.name !== f.name) {
        f.name = row.name;
        changed = true;
      }
      if (row.parentName !== f.parentName) {
        f.parentName = row.parentName;
        changed = true;
      }
    }
    if (changed) saveAll(list);
  }

  function starLabel(on) {
    return on
      ? "お気に入りのフォルダから外す（Stock Plus）"
      : "お気に入りのフォルダに追加（Stock Plus）";
  }

  /** 各フォルダ行にホバーで出る★ボタンを付け、ON/OFFの見た目を合わせる */
  function ensureRowButtons(team, rows, favIds) {
    for (const id of Object.keys(rows)) {
      const row = rows[id];
      let btn = row.li.querySelector(":scope > ." + ROW_BTN_CLASS);
      if (btn && btn.dataset.stockPlusInstance !== window.StockPlus.instanceId) {
        btn.remove();
        btn = null;
      }
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = ROW_BTN_CLASS;
        btn.dataset.stockPlusInstance = window.StockPlus.instanceId;
        btn.innerHTML = STAR_SVG;
        btn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          // クリック時点の最新の行情報で登録する
          toggleFavorite(team, id, collectFolderRows()[id]);
        });
        row.li.classList.add("stock-plus-favfolder-row");
        row.li.appendChild(btn);
      }
      const on = favIds.has(id);
      btn.classList.toggle("active", on);
      const label = starLabel(on);
      if (btn.title !== label) btn.title = label;
    }
  }

  // ---- ノート一覧（第二カラム）の見出しの★ -----------------------------------

  /** 開いているフォルダの見出しで、⚙ の左隣に★ボタンを付ける */
  function ensureHeaderButton(team, favIds) {
    const folderId = currentRoute().folder;
    const nameBox = document.querySelector(SELECTORS.listHeaderNameBox);
    const config = nameBox && nameBox.querySelector(SELECTORS.listHeaderConfig);
    let btn = document.querySelector("." + HEADER_BTN_CLASS);
    // 新着ノート（/all/）等、フォルダ以外の一覧には出さない
    if (!config || !/^\d+$/.test(folderId)) {
      if (btn) btn.remove();
      return;
    }
    // 旧インスタンスのボタン（ハンドラが無効）や、位置がずれたものは作り直す
    if (
      btn &&
      (btn.dataset.stockPlusInstance !== window.StockPlus.instanceId ||
        btn.nextElementSibling !== config)
    ) {
      btn.remove();
      btn = null;
    }
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = HEADER_BTN_CLASS;
      btn.dataset.stockPlusInstance = window.StockPlus.instanceId;
      btn.innerHTML = STAR_SVG;
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = currentRoute().folder;
        // 左メニューに行が出ていればそこから、無ければ見出しのフォルダ名で登録する
        // （親フォルダ名は、その行が左メニューに表示された時に補完される）
        let row = collectFolderRows()[id];
        if (!row) {
          const nameEl = document.querySelector(
            `${SELECTORS.listHeaderNameBox} ${SELECTORS.listHeaderName}`
          );
          row = { name: nameEl ? nameEl.textContent.trim() : "", parentName: "" };
        }
        toggleFavorite(team, id, row);
      });
      config.insertAdjacentElement("beforebegin", btn);
    }
    const on = favIds.has(folderId);
    btn.classList.toggle("active", on);
    const label = starLabel(on);
    if (btn.title !== label) btn.title = label;
  }

  // ---- 左メニューの「お気に入りのフォルダ」リンク -----------------------------

  function ensureMenuLink(favs) {
    // 「お気に入りの記事」の下（その機能がOFFなら「新着ノート」の下）に置く
    const anchor =
      document.querySelector(SELECTORS.favStocksLink) ||
      document.querySelector(SELECTORS.allStocksLink);
    let link = document.querySelector("." + LINK_CLASS);
    if (!anchor) return;

    if (
      link &&
      (link.dataset.stockPlusInstance !== window.StockPlus.instanceId ||
        link.previousElementSibling !== anchor)
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
      label.textContent = "お気に入りのフォルダ";
      const count = document.createElement("span");
      count.className = "allStocksLnk__unreadCount stock-plus-favfolder-count";
      link.appendChild(label);
      link.appendChild(count);
      link.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        enterMode();
      });
      anchor.insertAdjacentElement("afterend", link);
    }

    const countText = favs.length > 0 ? `(${favs.length})` : "";
    const countEl = link.querySelector(".stock-plus-favfolder-count");
    if (countEl.textContent !== countText) countEl.textContent = countText;
    link.classList.toggle("isSelected", modePath !== null);
  }

  // ---- 「お気に入りのフォルダ」一覧（ノート一覧の欄に重ねて表示） -------------

  function enterMode() {
    const { team } = currentRoute();
    if (!team) return;
    // ノート一覧の欄が無い画面なら、欄がある画面（新着ノート）へ移ってから重ねる
    if (!document.querySelector(SELECTORS.stocksContent)) {
      navigate(`/teams/${team}/dashboard/all/stocks`);
    }
    modePath = location.pathname;
    scheduleRefresh();
  }

  function exitMode() {
    if (modePath === null) return;
    modePath = null;
    scheduleRefresh();
  }

  function formatDate(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  }

  function openFolder(fav) {
    exitMode();
    // 本来の行が描画されていればそれを押す（Stock側の選択状態等もそのまま動く）
    const current = collectFolderRows()[fav.folderId];
    if (current) current.link.click();
    else navigate(folderPath(fav.team, fav.folderId));
  }

  /** 一覧の1件（「お気に入りの記事」の一覧と同じ見た目: 上に親フォルダ名、下にフォルダ名） */
  function buildItem(fav, row) {
    const li = document.createElement("li");
    li.className = "stockListItem";

    const a = document.createElement("a");
    a.className = "stockListItem__lnkArea";
    a.href = folderPath(fav.team, fav.folderId);
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      openFolder(fav);
    });

    const area = document.createElement("div");
    area.className = "stockListItem__stockArea";

    if (fav.parentName) {
      const groupBox = document.createElement("div");
      groupBox.className = "stockListItem__groupNameBox";
      const g = document.createElement("span");
      g.className = "stockListItem__groupNameBox__groupName";
      g.textContent = fav.parentName;
      groupBox.appendChild(g);
      area.appendChild(groupBox);
    }

    const titleBox = document.createElement("div");
    titleBox.className = "stockListItem__titleBox";
    const t = document.createElement("span");
    t.className = "stockListItem__titleBox__title";
    t.textContent = fav.name || "(名前不明のフォルダ)";
    titleBox.appendChild(t);
    if (row && row.count) {
      const c = document.createElement("span");
      c.className = "stock-plus-favfolder-unread";
      c.textContent = row.count;
      titleBox.appendChild(c);
    }
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
    unfav.title = starLabel(true);
    unfav.innerHTML = STAR_SVG.replace(/width="12" height="12"/, 'width="16" height="16"');
    unfav.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleFavorite(fav.team, fav.folderId, null);
    });
    li.appendChild(unfav);
    return li;
  }

  function ensurePanel(rows, favs) {
    const content = document.querySelector(SELECTORS.stocksContent);
    let panel = document.querySelector("." + PANEL_CLASS);
    if (modePath === null || !content) {
      if (panel) panel.remove();
      return;
    }

    const view = favs.map((f) => [
      f.folderId,
      f.name,
      f.parentName,
      f.savedAt,
      rows[f.folderId] ? rows[f.folderId].count : "",
    ]);
    // 自分のDOM更新でオブザーバが再発火しても作り直さないよう、内容が変わったときだけ描画する
    const signature = JSON.stringify([window.StockPlus.instanceId, view]);
    if (panel && panel.parentElement === content && panel.dataset.signature === signature) {
      return;
    }
    if (panel) panel.remove();

    // 見た目は「お気に入りの記事」の一覧（.stock-plus-fav-panel）と共通のCSSを使う
    panel = document.createElement("div");
    panel.className = PANEL_CLASS;
    panel.dataset.signature = signature;

    const header = document.createElement("div");
    header.className = "stocksHeader";
    header.innerHTML =
      '<div class="stocksHeaderBox"><div class="stocksHeaderBox__groupNameArea--uneditable">' +
      '<div class="groupNameBox"><p class="groupName"></p></div></div></div>';
    header.querySelector(".groupName").textContent = "お気に入りのフォルダ";
    panel.appendChild(header);

    const listWrap = document.createElement("div");
    listWrap.className = "stockList stock-plus-fav-list";
    if (favs.length === 0) {
      const empty = document.createElement("p");
      empty.className = "stock-plus-fav-empty";
      empty.textContent =
        "お気に入りのフォルダはまだありません。左メニューのフォルダや、ノート一覧の上の ★ から登録できます。";
      listWrap.appendChild(empty);
    } else {
      const ul = document.createElement("ul");
      for (const fav of favs) ul.appendChild(buildItem(fav, rows[fav.folderId]));
      listWrap.appendChild(ul);
    }
    panel.appendChild(listWrap);
    content.appendChild(panel);
  }

  function initModeExit() {
    // 左メニューで他のリンク（新着ノート・お気に入りの記事・フォルダ等）を選んだら抜ける（フォルダの★は除く）
    document.addEventListener(
      "click",
      (ev) => {
        if (modePath === null || !window.StockPlus.isCurrentInstance()) return;
        if (!(ev.target instanceof Element)) return;
        const inMenu = ev.target.closest(SELECTORS.groupsBody);
        // 行の★は登録するだけで画面を移らないので、一覧は開いたままにする
        if (inMenu && !ev.target.closest(`.${LINK_CLASS}, .${ROW_BTN_CLASS}`)) exitMode();
      },
      true
    );
  }

  // ---- 全体の更新 ------------------------------------------------------------

  function removeAll() {
    modePath = null;
    document.documentElement.classList.remove(MODE_CLASS);
    document
      .querySelectorAll(`.${ROW_BTN_CLASS}, .${HEADER_BTN_CLASS}, .${LINK_CLASS}, .${PANEL_CLASS}`)
      .forEach((el) => el.remove());
    document
      .querySelectorAll(".stock-plus-favfolder-row")
      .forEach((el) => el.classList.remove("stock-plus-favfolder-row"));
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
      // 別の画面へ移動した（フォルダ・記事・検索のリンク等）ら一覧表示を抜ける
      if (modePath !== null && location.pathname !== modePath) modePath = null;
      document.documentElement.classList.toggle(MODE_CLASS, modePath !== null);
      const { team } = currentRoute();
      if (!team || !document.querySelector(SELECTORS.groupsBody)) return;
      const rows = collectFolderRows();
      syncNames(team, rows);
      const favs = teamFavorites(team);
      const favIds = new Set(favs.map((f) => f.folderId));
      ensureRowButtons(team, rows, favIds);
      ensureHeaderButton(team, favIds);
      ensureMenuLink(favs);
      ensurePanel(rows, favs);
    }, 200);
  }

  window.StockPlus.registerFeature({
    id: SETTING_ID,
    name: "お気に入りのフォルダ",
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
