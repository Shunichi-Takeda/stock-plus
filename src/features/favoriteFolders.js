/**
 * Stock Plus - 機能: お気に入りのフォルダ
 *
 *  - 左メニューの各フォルダ行（親フォルダの中のフォルダ）にマウスを乗せると、
 *    右端に ★ ボタンが出て、お気に入りのON/OFFを切り替えられる
 *  - 左メニューの「お気に入りの記事」の下に「お気に入りのフォルダ」欄を追加し、
 *    登録したフォルダを並べる。各行には所属する親フォルダ名も表示する
 *  - 欄のフォルダを選ぶと、そのフォルダのノート一覧を開く（ページ再読込なし）
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
    // Stock本来のフォルダ一覧（この直前に「お気に入りのフォルダ」欄を入れる）
    groupCollectionList: ".groupsBody > ul.groupCollectionList",
    // フォルダ行とリンク・名前・未読数
    folderItem: "li.groupListItem",
    folderLink: "a.groupBoxLnk",
    folderName: ".groupBoxLnk__name > span:first-child",
    folderCount: ".groupBoxLnk__name__count",
    // 親フォルダの行と名前
    parentItem: ".groupCollectionListItem",
    parentName: ".groupCollectionBox__name > span:first-child",
  };
  // ----------------------------------------------------------------------

  const SETTING_ID = "favorite-folders";
  const STORAGE_KEY = "stockPlus.favoriteFolders";
  const COLLAPSED_KEY = "stockPlus.favoriteFolders.collapsed";
  const ROW_BTN_CLASS = "stock-plus-favfolder-btn";
  const SECTION_CLASS = "stock-plus-favfolder-section";

  const STAR_SVG =
    '<svg viewBox="0 0 576 512" width="12" height="12" fill="currentColor" aria-hidden="true">' +
    '<path d="M259.3 17.8L194 150.2 47.9 171.5c-26.2 3.8-36.7 36.1-17.7 54.6l105.7 103-25 145.5c-4.5 26.3 23.2 46 46.4 33.7L288 439.6l130.7 68.7c23.2 12.2 50.9-7.4 46.4-33.7l-25-145.5 105.7-103c19-18.5 8.5-50.8-17.7-54.6L382 150.2 316.7 17.8c-11.7-23.6-45.6-23.9-57.4 0z"/>' +
    "</svg>";

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

  /** 現在のチームのお気に入り（登録した順） */
  function teamFavorites(team) {
    return loadAll()
      .filter((f) => f.team === team)
      .sort((a, b) => a.savedAt - b.savedAt);
  }

  function isCollapsed() {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setCollapsed(on) {
    try {
      localStorage.setItem(COLLAPSED_KEY, on ? "1" : "0");
    } catch (e) {
      // 保存できなくても表示の切り替えだけは行う
    }
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

  /** 左メニューに描画されているフォルダ行（自前の欄は除く）を {id: 情報} で返す */
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
      const label = on
        ? "お気に入りのフォルダから外す（Stock Plus）"
        : "お気に入りのフォルダに追加（Stock Plus）";
      if (btn.title !== label) btn.title = label;
    }
  }

  // ---- 「お気に入りのフォルダ」欄 ---------------------------------------------

  function buildItem(fav, row, selected) {
    const li = document.createElement("li");
    li.className = "groupListItem stock-plus-favfolder-item" + (selected ? " isSelected" : "");

    const a = document.createElement("a");
    a.className = "groupBoxLnk indented";
    a.href = folderPath(fav.team, fav.folderId);
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      // 本来の行が描画されていればそれを押す（Stock側の選択状態等もそのまま動く）
      const current = collectFolderRows()[fav.folderId];
      if (current) current.link.click();
      else navigate(folderPath(fav.team, fav.folderId));
    });

    // Stockのフォルダ行と同じ「●」アイコン
    const icon = document.createElement("i");
    icon.className = "groupBoxLnk__icon";
    a.appendChild(icon);

    // フォルダ名（未読数）と、その下に親フォルダ名
    const text = document.createElement("div");
    text.className = "stock-plus-favfolder-text";
    const name = document.createElement("p");
    name.className = "groupBoxLnk__name";
    const n = document.createElement("span");
    n.textContent = fav.name || "(名前不明のフォルダ)";
    name.appendChild(n);
    if (row && row.count) {
      const c = document.createElement("span");
      c.className = "groupBoxLnk__name__count";
      c.textContent = row.count;
      name.appendChild(c);
    }
    text.appendChild(name);
    if (fav.parentName) {
      const p = document.createElement("p");
      p.className = "stock-plus-favfolder-parent";
      p.textContent = fav.parentName;
      p.title = "親フォルダ: " + fav.parentName;
      text.appendChild(p);
    }
    a.appendChild(text);
    li.appendChild(a);

    // 欄からも外せるようにする
    const unfav = document.createElement("button");
    unfav.type = "button";
    unfav.className = ROW_BTN_CLASS + " active";
    unfav.title = "お気に入りのフォルダから外す（Stock Plus）";
    unfav.innerHTML = STAR_SVG;
    unfav.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleFavorite(fav.team, fav.folderId, null);
    });
    li.appendChild(unfav);
    return li;
  }

  function ensureSection(team, rows, favs) {
    const collectionList = document.querySelector(SELECTORS.groupCollectionList);
    let section = document.querySelector("." + SECTION_CLASS);
    if (!collectionList || favs.length === 0) {
      if (section) section.remove();
      return;
    }

    const selectedId = currentRoute().folder;
    const collapsed = isCollapsed();
    const view = favs.map((f) => [f.folderId, f.name, f.parentName, rows[f.folderId] ? rows[f.folderId].count : ""]);
    // 自分のDOM更新でオブザーバが再発火しても作り直さないよう、内容が変わったときだけ描画する
    const signature = JSON.stringify([window.StockPlus.instanceId, selectedId, collapsed, view]);
    if (
      section &&
      section.nextElementSibling === collectionList &&
      section.dataset.signature === signature
    ) {
      return;
    }
    if (section) section.remove();

    section = document.createElement("div");
    section.className = SECTION_CLASS + (collapsed ? " isCollapsed" : "");
    section.dataset.signature = signature;

    const header = document.createElement("button");
    header.type = "button";
    header.className = "stock-plus-favfolder-header";
    header.innerHTML = '<span class="stock-plus-favfolder-caret"></span>' + STAR_SVG + "<span></span>";
    header.lastElementChild.textContent = `お気に入りのフォルダ (${favs.length})`;
    header.title = collapsed ? "開く" : "閉じる";
    header.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      setCollapsed(!isCollapsed());
      scheduleRefresh();
    });
    section.appendChild(header);

    if (!collapsed) {
      const ul = document.createElement("ul");
      ul.className = "stock-plus-favfolder-list";
      for (const fav of favs) {
        ul.appendChild(buildItem(fav, rows[fav.folderId], fav.folderId === selectedId));
      }
      section.appendChild(ul);
    }
    collectionList.insertAdjacentElement("beforebegin", section);
  }

  // ---- 全体の更新 ------------------------------------------------------------

  function removeAll() {
    document
      .querySelectorAll(`.${ROW_BTN_CLASS}, .${SECTION_CLASS}`)
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
      const { team } = currentRoute();
      if (!team || !document.querySelector(SELECTORS.groupsBody)) return;
      const rows = collectFolderRows();
      syncNames(team, rows);
      const favs = teamFavorites(team);
      ensureRowButtons(team, rows, new Set(favs.map((f) => f.folderId)));
      ensureSection(team, rows, favs);
    }, 200);
  }

  window.StockPlus.registerFeature({
    id: SETTING_ID,
    name: "お気に入りのフォルダ",
    init() {
      const observer = new MutationObserver(() => scheduleRefresh());
      observer.observe(document.body, { childList: true, subtree: true });
      window.addEventListener("popstate", () => scheduleRefresh());
      scheduleRefresh();
    },
    refresh: scheduleRefresh,
  });
})();
