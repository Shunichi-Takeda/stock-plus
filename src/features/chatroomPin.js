/**
 * Stock Plus - 機能: チャット詳細画面のピン留めボタン
 *
 * メッセージ一覧にある「ピン留め」（サムタック）を、開いているチャット
 * ウィンドウのヘッダー右上にも追加する。クリックすると、一覧側の該当
 * スレッドのピン留めボタンを探して切り替える（宛先名の照合キーで対応付け）。
 */
(function () {
  "use strict";

  // ---- チューニングポイント: Stock側のDOMに合わせて調整する場所 ----------
  const SELECTORS = {
    chatroom: ".chatroom",
    // ヘッダー内のボタン列（この先頭にピン留めボタンを挿入する）
    nameBoxButtons: ".chatroom__nameBox__button",
    nameBox: ".chatroom__nameBox",
    chatroomName: "[class*='chatroom__nameBox__name']",
    chatroomNameFallback: ".chatroom__nameBox__memberNames",
    openChatModalButton: "button.openChatGroupsModalBtn",
    chatGroupsList: ".chatGroupsModal__chatGroups",
    listItem: "li.chatGroupListItem",
    listItemName: ".chatGroupListItem__wrappedName",
    listItemNameFallback: ".chatGroupListItem__groupName",
    // 一覧側のピン留めボタン（active クラスでピン状態を表す）
    tackBtn: ".chatGroupListItem__tackBtn",
  };
  // ----------------------------------------------------------------------

  const BTN_CLASS = "stock-plus-pin-btn";
  // 一覧側のピン留めと同じFontAwesomeサムタックアイコン（同サイズ: 高さ16px）
  const PIN_SVG =
    '<svg viewBox="0 0 384 512" width="12" height="16" fill="currentColor" aria-hidden="true">' +
    '<path d="M298.028 214.267L285.793 96H328c13.255 0 24-10.745 24-24V24c0-13.255-10.745-24-24-24H56C42.745 0 32 10.745 32 24v48c0 13.255 10.745 24 24 24h42.207L85.972 214.267C37.465 236.82 0 277.261 0 328c0 13.255 10.745 24 24 24h136v104.007c0 1.242.289 2.467.845 3.578l24 48c2.941 5.882 11.364 5.893 14.311 0l24-48a8.008 8.008 0 0 0 .845-3.578V352h136c13.255 0 24-10.745 24-24-.001-51.183-37.983-91.42-85.973-113.733z"/>' +
    "</svg>";

  const matchKey = window.StockPlus.matchKey;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function recipientOfRoom(room) {
    const nameEl =
      room.querySelector(SELECTORS.chatroomName) ||
      room.querySelector(SELECTORS.chatroomNameFallback);
    const text = nameEl && nameEl.textContent && nameEl.textContent.trim();
    return text || null;
  }

  /** 照合キーが一致する一覧項目を探す */
  function findListItem(key) {
    if (!key) return null;
    for (const item of document.querySelectorAll(SELECTORS.listItem)) {
      const el =
        item.querySelector(SELECTORS.listItemName) ||
        item.querySelector(SELECTORS.listItemNameFallback);
      if (!el) continue;
      let text = "";
      for (const node of el.childNodes) {
        if (node.nodeType === 1 && node.classList.contains("stock-plus-badge")) continue;
        text += node.textContent;
      }
      if (matchKey(text) === key) return item;
    }
    return null;
  }

  /** 一覧側のピン状態を自前ボタンへ反映する（一覧が読み込まれている場合のみ） */
  function syncState(room, btn) {
    const item = findListItem(matchKey(recipientOfRoom(room)));
    if (!item) return;
    const tack = item.querySelector(SELECTORS.tackBtn);
    if (tack) btn.classList.toggle("active", tack.classList.contains("active"));
  }

  /** ピン留めを切り替える（一覧側のtackBtnをクリックする） */
  async function togglePin(room, btn) {
    const recipient = recipientOfRoom(room);
    if (!recipient) return;
    const key = matchKey(recipient);

    let item = findListItem(key);
    let openedByUs = false;

    // 一覧が閉じている・未読み込みならモーダルを開いて再探索
    if (!item) {
      const opener = document.querySelector(SELECTORS.openChatModalButton);
      if (opener && !document.querySelector(SELECTORS.chatGroupsList)) {
        opener.click();
        openedByUs = true;
        await sleep(900);
      }
      item = findListItem(key);
    }

    if (!item) {
      alert(
        "メッセージ一覧にこのスレッドが見つからないため、ピン留めを切り替えられませんでした。"
      );
    } else {
      const tack = item.querySelector(SELECTORS.tackBtn);
      if (tack) {
        tack.click();
        await sleep(300);
        btn.classList.toggle("active", tack.classList.contains("active"));
      }
    }

    // 自分で開いたモーダルは閉じて元の状態に戻す
    if (openedByUs) {
      document.querySelector(SELECTORS.openChatModalButton)?.click();
    }
  }

  /** 開いている各チャットウィンドウにピン留めボタンを挿入する */
  function ensurePinButtons() {
    for (const room of document.querySelectorAll(SELECTORS.chatroom)) {
      const nameBox = room.querySelector(SELECTORS.nameBox);
      if (!nameBox) continue;

      const existing = nameBox.querySelector("." + BTN_CLASS);
      if (existing) {
        if (existing.dataset.stockPlusInstance === window.StockPlus.instanceId) {
          syncState(room, existing);
          continue;
        }
        existing.remove(); // 旧インスタンスのボタンは作り直す
      }

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = BTN_CLASS;
      btn.title = "ピン留めを切り替え（Stock Plus）";
      btn.dataset.stockPlusInstance = window.StockPlus.instanceId;
      btn.innerHTML = PIN_SVG;
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        togglePin(room, btn);
      });

      // ヘッダー右上のボタン列の先頭（既存ボタンの左）に挿入
      const firstBtn = nameBox.querySelector(SELECTORS.nameBoxButtons);
      if (firstBtn) {
        firstBtn.insertAdjacentElement("beforebegin", btn);
      } else {
        nameBox.appendChild(btn);
      }
      syncState(room, btn);
    }
  }

  let timer = null;

  function scheduleRefresh() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!window.StockPlus.isCurrentInstance()) return;
      ensurePinButtons();
    }, 300);
  }

  window.StockPlus.registerFeature({
    id: "chatroom-pin",
    name: "チャット詳細画面のピン留めボタン",
    init() {
      const observer = new MutationObserver(() => scheduleRefresh());
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleRefresh();
    },
  });
})();
