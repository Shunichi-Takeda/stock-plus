/**
 * Stock Plus - 機能: 「ありがとう」「完了しました」リアクション（ページ側）
 *
 * Stock のリアクション（了解しました・絵文字）はサーバー側で種類が固定されているため、
 * 「専用の小さなメッセージ」を送ることで「🙏 ありがとう」「✅ 完了しました」を表現する。
 *
 *  - 送信するメッセージ: 「🙏 ありがとう\n> 〇〇さん「元メッセージ…」」
 *    1行目の末尾に、対象メッセージのIDを不可視文字（ゼロ幅文字）で埋め込む
 *  - Stock Plus を入れている人: 専用メッセージは非表示になり、元メッセージの下に
 *    「了解しました」と同じ形式（「2人がありがとう」）で表示される。押した人の一覧も同じ形式
 *  - 入れていない人（スマホアプリ等を含む）: 普通のメッセージとしてそのまま読める
 *  - 取り消しは、自分が送った専用メッセージを Stock 標準の「削除」で消す（確認ダイアログは出さない）
 *
 * このファイルはページ側（manifest の world: "MAIN"）で動く。
 * 誰の投稿か・メンバー一覧などを Stock（React）の内部データから読む必要があり、
 * 通常の content script（isolated world）からは読めないため。
 * ON/OFF とオプションは thanksDoneReactions.js（isolated world）が <html> の属性で渡す:
 *   data-stock-plus-reactions="on|off"
 *   data-stock-plus-reactions-hide-unread="on|off"（「未読に戻す」を隠すか）
 *
 * 単体版の拡張機能「Stock Reactions」（https://github.com/t-tanimo/stock-reactions）と
 * 送受信するメッセージの形式は同じ。両方入っている場合は先に読み込まれた方だけが動く。
 */
(() => {
  "use strict";
  // 単体版「Stock Reactions」が先に動いていたら、こちらは動かさない（ボタンの二重表示を防ぐ）
  if (window.__stockReactionsPlus && window.__stockReactionsPlus !== "stock-plus") return;
  window.__stockReactionsPlus = "stock-plus";

  // インスタンスガード: 拡張を再読み込みすると古いスクリプトがページに残るため、最新のものだけ動かす
  const ROOT = document.documentElement;
  const INSTANCE_ID = Date.now() + "-" + Math.random().toString(36).slice(2);
  ROOT.setAttribute("data-stock-plus-rx-instance", INSTANCE_ID);
  const isCurrent = () => ROOT.getAttribute("data-stock-plus-rx-instance") === INSTANCE_ID;
  const isEnabled = () => isCurrent() && ROOT.getAttribute("data-stock-plus-reactions") === "on";
  const hideUnread = () => ROOT.getAttribute("data-stock-plus-reactions-hide-unread") !== "off";

  // type は送信済みメッセージに埋め込まれるため変更しない（done = 完了しました。旧表記「対応済み」）
  const TYPES = {
    thanks: { label: "ありがとう", undo: "ありがとう解除", emoji: "🙏" },
    done: { label: "完了しました", undo: "完了解除", emoji: "✅" },
  };
  const TYPE_ORDER = ["thanks", "done"];
  const PREFIX = "srx1";
  const ACK_LABELS = ["了解しました", "了解解除", "対応します！", "対応解除"];

  // ---------- 不可視タグ（対象メッセージIDの埋め込み） ----------
  const ZW0 = "​";
  const ZW1 = "‌";
  const ZWSEP = "⁣";

  function encodeTag(type, targetId) {
    const s = `${PREFIX}:${type}:${targetId}`;
    const bits = [...s].map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join("");
    return ZWSEP + bits.replace(/0/g, ZW0).replace(/1/g, ZW1) + ZWSEP;
  }

  // 予備: 不可視文字が消された場合に備え、見える形式 [srx:done:123] も読めるようにしておく
  const VISIBLE_TAG_RE = /\[srx:(thanks|done):(\d+)\]/;

  function decodeTag(text) {
    if (!text) return null;
    const m = text.match(/⁣([​‌]+)⁣/);
    if (m) {
      const bits = m[1].replace(/​/g, "0").replace(/‌/g, "1");
      let s = "";
      for (let i = 0; i + 8 <= bits.length; i += 8) s += String.fromCharCode(parseInt(bits.slice(i, i + 8), 2));
      const [prefix, type, id] = s.split(":");
      if (prefix === PREFIX && TYPES[type] && /^\d+$/.test(id || "")) return { type, targetId: id };
    }
    const v = text.match(VISIBLE_TAG_RE);
    if (v) return { type: v[1], targetId: v[2] };
    return null;
  }

  // ---------- Stock の画面から情報を読む ----------
  function fiberPropsWith(el, key) {
    const fk = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
    let f = fk ? el[fk] : null;
    for (let i = 0; i < 12 && f; i++, f = f.return) {
      const p = f.memoizedProps;
      if (p && typeof p === "object" && key in p) return p;
    }
    return null;
  }

  function chatMeta(item) {
    try {
      const p = fiberPropsWith(item, "chat");
      if (!p) return {};
      return {
        userId: p.chat && p.chat.userId,
        meId: p.me && p.me.id,
        poster: p.poster,
        members: Array.isArray(p.members) ? p.members : null,
      };
    } catch (_) {
      return {};
    }
  }

  function userName(u) {
    if (!u) return "";
    return u.name || [u.lastname, u.firstname].filter(Boolean).join(" ") || "";
  }

  function posterName(item) {
    const el = item.querySelector('[class^="chatListItem__topBox__name"]');
    const name = el && el.textContent.trim();
    if (name) return name;
    return userName(chatMeta(item).poster);
  }

  function messageText(item) {
    const el = item.querySelector(".chatListItem__message");
    return el ? el.textContent : "";
  }

  function snippetOf(item) {
    const line =
      messageText(item)
        .replace(/[​‌⁣]/g, "")
        .split('\n')
        .map((s) => s.trim())
        .find(Boolean) || "";
    const s = line.replace(/@/g, "＠");
    return s.length > 30 ? s.slice(0, 30) + "…" : s;
  }

  const itemById = (id) => document.querySelector(`.chatListItem[data-chat-id="${id}"]`);

  // ---------- 送信 ----------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;

  function setTextareaValue(ta, v) {
    valueSetter.call(ta, v);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function findComposer(item) {
    for (let el = item.parentElement; el && el !== document.body; el = el.parentElement) {
      const ta = el.querySelector("textarea.chatroom__messageTextArea");
      const btn = el.querySelector(".chatroom__toolBar__sendBtn");
      if (ta && btn) return { ta, btn };
    }
    return null;
  }

  let busy = false;
  async function sendMessage(item, text) {
    const c = findComposer(item);
    if (!c) {
      toast("送信欄が見つかりませんでした。メッセージ欄を開いてからお試しください。");
      return false;
    }
    const draft = c.ta.value;
    setTextareaValue(c.ta, text);
    await sleep(80);
    c.btn.click();
    await sleep(700);
    if (draft && !c.ta.value) setTextareaValue(c.ta, draft); // 書きかけの内容を戻す
    return true;
  }

  // 専用メッセージを、Stock の「削除」→ 確認ダイアログの OK まで自動で押して消す（確認は表示しない）
  async function deleteMarker(markerId) {
    const marker = itemById(markerId);
    const del = marker && [...marker.querySelectorAll(".chatListItemToolBox button")].find((b) => b.textContent.trim() === "削除");
    if (!del) return false;
    // ダイアログは visibility で隠す（opacity を固定すると閉じるアニメーションが終わらず、
    // 透明なダイアログが画面に残ってクリックできなくなるため）
    document.body.classList.add("stock-plus-rx-silent");
    let ok = null;
    try {
      del.click();
      for (let i = 0; i < 30 && !ok; i++) {
        await sleep(50);
        ok = [...document.querySelectorAll(".modal button")].find(
          (b) => b.textContent.trim() === "OK" && /削除してもよろしいですか/.test(b.closest(".modal").textContent)
        );
      }
      if (ok) ok.click();
      // ダイアログが閉じきるまで待つ
      for (let i = 0; i < 40 && document.querySelector(".modal, .modal-backdrop"); i++) await sleep(50);
      // それでも残っていたら、閉じるアニメーションの終了を通知して片付ける
      document.querySelectorAll(".modal, .modal-backdrop").forEach((m) => {
        if (!m.classList.contains("show")) m.dispatchEvent(new TransitionEvent("transitionend", { bubbles: true, propertyName: "opacity" }));
      });
      await sleep(100);
      return !!ok;
    } finally {
      document.body.classList.remove("stock-plus-rx-silent");
    }
  }

  // ---------- 状態の集計 ----------
  /** targetId -> { type -> Map(userKey -> { userId, name, mine, markerIds[] }) } */
  let state = new Map();

  function collect() {
    const next = new Map();
    for (const item of document.querySelectorAll(".chatListItem[data-chat-id]")) {
      const tag = decodeTag(messageText(item));
      if (!tag) {
        item.classList.remove("stock-plus-rx-marker");
        continue;
      }
      item.classList.add("stock-plus-rx-marker");
      const meta = chatMeta(item);
      const name = posterName(item);
      const mine = meta.userId != null && meta.userId === meta.meId;
      const key = meta.userId != null ? `u${meta.userId}` : `n${name}`;
      if (!next.has(tag.targetId)) next.set(tag.targetId, {});
      const byType = next.get(tag.targetId);
      if (!byType[tag.type]) byType[tag.type] = new Map();
      const users = byType[tag.type];
      const u = users.get(key) || { userId: meta.userId, name, mine, markerIds: [] };
      u.markerIds.push(item.dataset.chatId);
      users.set(key, u);
    }
    state = next;
  }

  function reactorsOf(targetId, type) {
    const users = (state.get(targetId) || {})[type];
    return users ? [...users.values()] : [];
  }

  const myReaction = (targetId, type) => reactorsOf(targetId, type).find((u) => u.mine) || null;

  // ---------- 描画 ----------
  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  // ホバー時の操作ボタン（「了解しました」の右）
  function ensureButtons(item) {
    const box = item.querySelector(".chatListItemToolBox");
    if (!box) return;
    // 「未読に戻す」を隠してボタン列の幅を空ける（設定画面のオプション。デフォルトON）
    for (const b of box.querySelectorAll(":scope > button:not(.stock-plus-rx-btn)")) {
      if (b.textContent.trim() === "未読に戻す") b.classList.toggle("stock-plus-rx-hide", hideUnread());
    }
    let btns = box.querySelectorAll(".stock-plus-rx-btn");
    if (!btns.length) {
      const ack = [...box.children].find((b) => b.tagName === "BUTTON" && ACK_LABELS.includes(b.textContent.trim()));
      if (!ack) return; // 了解ボタンが出ないメッセージ（自分の投稿・システム通知など）には付けない
      let ref = ack;
      for (const type of TYPE_ORDER) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "stock-plus-rx-btn";
        b.dataset.stockPlusRxType = type;
        b.dataset.stockPlusRxAction = "toggle";
        b.innerHTML = `<span class="stock-plus-rx-emoji">${TYPES[type].emoji}</span><span class="stock-plus-rx-btn__label"></span>`;
        ref.after(b);
        ref = b;
      }
      btns = box.querySelectorAll(".stock-plus-rx-btn");
    }
    for (const b of btns) {
      const t = TYPES[b.dataset.stockPlusRxType];
      const label = myReaction(item.dataset.chatId, b.dataset.stockPlusRxType) ? t.undo : t.label;
      setText(b.querySelector(".stock-plus-rx-btn__label"), label);
      if (b.title !== label) b.title = label;
    }
  }

  /*
   * ボタン列が一覧の表示枠の下に隠れる場合（一番下のメッセージなど）は、ボタン列が見えるところまで
   * 一覧をスクロールする。本文に重ねて出すと末尾のURLなどが隠れるため、重ねない。
   * 一覧の下にスクロールの余地がなければ、一覧の下端に余白を足してからスクロールする。
   */
  const ROOM_ATTR = "data-stock-plus-rx-room"; // 足した余白(px)。設定OFFのときに戻すために覚えておく
  function scrollerOf(item) {
    let el = item.parentElement;
    while (el && el !== document.body && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    return el && el !== document.body ? el : null;
  }
  function fitToolBox(item) {
    if (!isEnabled()) return;
    const box = item.querySelector(".chatListItemToolBox");
    if (!box || !box.querySelector(".stock-plus-rx-btn") || !box.offsetWidth) return;
    const scroller = scrollerOf(item);
    if (!scroller) return;
    const view = scroller.getBoundingClientRect();
    const overflow = Math.ceil(box.getBoundingClientRect().bottom - (view.top + scroller.clientHeight)) + 4;
    if (overflow <= 4) return;
    // メッセージ自体が表示枠の下にはみ出しているときは、Stock本来の動きと同じく何もしない
    if (item.getBoundingClientRect().bottom > view.top + scroller.clientHeight + 1) return;
    const remaining = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    if (remaining < overflow) {
      const added = Number(scroller.getAttribute(ROOM_ATTR) || 0) + Math.ceil(overflow - remaining);
      const base = parseFloat(getComputedStyle(scroller).paddingBottom) - Number(scroller.getAttribute(ROOM_ATTR) || 0);
      scroller.setAttribute(ROOM_ATTR, String(added));
      scroller.style.setProperty("padding-bottom", `${base + added}px`);
    }
    scroller.scrollTop += overflow;
  }
  function removeRoom() {
    document.querySelectorAll(`[${ROOM_ATTR}]`).forEach((el) => {
      const added = Number(el.getAttribute(ROOM_ATTR) || 0);
      const cur = parseFloat(el.style.paddingBottom);
      if (!Number.isNaN(cur)) el.style.paddingBottom = cur - added > 0 ? `${cur - added}px` : "";
      el.removeAttribute(ROOM_ATTR);
    });
  }

  let lastHovered = null;
  document.addEventListener("mouseover", (e) => {
    const item = e.target.closest && e.target.closest(".chatListItem[data-chat-id]");
    // メッセージの外から入ってきたときに測る（スクロール中に自動でスクロールし返さないよう、スクロールでは測らない）
    if (item && !(e.relatedTarget instanceof Node && item.contains(e.relatedTarget))) {
      lastHovered = item;
      fitToolBox(item);
    }
  });

  // メッセージ下の表示（「1人が了解しました」と同じ形式）
  function renderReactions(item) {
    const bottom = item.querySelector(".chatListItemBottom");
    if (!bottom) return;
    const id = item.dataset.chatId;
    const rows = TYPE_ORDER.map((type) => ({ type, users: reactorsOf(id, type) })).filter((r) => r.users.length);
    const sig = JSON.stringify(rows.map((r) => [r.type, r.users.length, r.users.some((u) => u.mine)]));
    const existing = bottom.querySelectorAll(":scope > .stock-plus-rx-reactions");
    if (bottom.dataset.stockPlusRxSig === sig && existing.length === rows.length) return;
    bottom.dataset.stockPlusRxSig = sig;
    existing.forEach((e) => e.remove());
    const before = bottom.querySelector(":scope > .chatListItemEmotionsContainer");
    for (const r of rows) {
      const t = TYPES[r.type];
      const reacted = r.users.some((u) => u.mine);
      const c = document.createElement("div");
      c.className = "chatListItemReactionsContainer stock-plus-rx-reactions" + (reacted ? " reacted" : "");
      c.dataset.stockPlusRxType = r.type;
      c.innerHTML =
        `<button type="button" class="chatListItemReactionsContainer__button" data-stock-plus-rx-type="${r.type}" data-stock-plus-rx-action="toggle-or-list">` +
        `<span class="stock-plus-rx-emoji">${t.emoji}</span></button>` +
        `<a class="chatListItemReactionsContainer__link" data-stock-plus-rx-type="${r.type}" data-stock-plus-rx-action="list"></a>`;
      c.querySelector("a").textContent = `${r.users.length}人が${t.label}`;
      bottom.insertBefore(c, before);
    }
  }

  /** 設定OFFのとき: 足したもの（ボタン・表示・非表示にした専用メッセージ）をすべて元に戻す */
  function teardown() {
    closePopover();
    document.querySelectorAll(".stock-plus-rx-btn, .stock-plus-rx-reactions").forEach((e) => e.remove());
    removeRoom();
    for (const cls of ["stock-plus-rx-marker", "stock-plus-rx-hide"]) {
      document.querySelectorAll("." + cls).forEach((e) => e.classList.remove(cls));
    }
    document.querySelectorAll("[data-stock-plus-rx-sig]").forEach((e) => delete e.dataset.stockPlusRxSig);
    state = new Map();
  }

  function refresh() {
    if (!isCurrent()) return;
    if (!isEnabled()) {
      teardown();
      return;
    }
    collect();
    for (const item of document.querySelectorAll(".chatListItem[data-chat-id]")) {
      if (item.classList.contains("stock-plus-rx-marker")) continue;
      ensureButtons(item);
      renderReactions(item);
    }
    if (openPopover && !document.body.contains(openPopover.anchor)) closePopover();
    if (lastHovered && lastHovered.isConnected && lastHovered.matches(":hover")) fitToolBox(lastHovered); // ラベルが変わったときに測り直す
  }

  // ---------- 押した人の一覧（Stock の「了解しました」と同じポップアップ） ----------
  let openPopover = null;

  function closePopover() {
    if (openPopover) openPopover.el.remove();
    openPopover = null;
  }

  function showPopover(item, type, anchor) {
    closePopover();
    const t = TYPES[type];
    const reactors = reactorsOf(item.dataset.chatId, type);
    const reactedIds = new Set(reactors.map((u) => u.userId));
    const { members } = chatMeta(item);
    let list;
    if (members && members.length) {
      const reacted = members.filter((m) => reactedIds.has(m.id));
      const others = members.filter((m) => !reactedIds.has(m.id));
      list = [...reacted, ...others].map((m) => ({ name: userName(m), avatar: m.middleAvatarUrl || m.avatarUrl, checked: reactedIds.has(m.id) }));
      // メンバー一覧に居ない人（退出済みなど）も表示する
      for (const u of reactors) if (!members.some((m) => m.id === u.userId)) list.unshift({ name: u.name, checked: true });
    } else {
      list = reactors.map((u) => ({ name: u.name, checked: true }));
    }

    const el = document.createElement("div");
    el.className = "fade customPopoverMenu show popover bs-popover-top stock-plus-rx-popover";
    el.setAttribute("role", "tooltip");
    el.innerHTML =
      '<div class="chatMembersPopover keepChatGroupsOpen">' +
      '<button type="button" class="chatMembersPopover__closeBtn"><i class="closeIcon"></i></button>' +
      '<p class="chatListItemReactionsPopoverHeader"><strong></strong></p>' +
      '<ul class="chatMembersPopover__list"></ul></div>';
    const header = el.querySelector(".chatListItemReactionsPopoverHeader");
    header.querySelector("strong").textContent = `${reactors.length}人`;
    header.append(`が${t.label}`);
    const ul = el.querySelector("ul");
    // Stock の「了解しました」と同じチェックアイコンを流用（見つからなければ ✓）
    const checkIcon = document.querySelector(".chatListItemToolBox svg.fa-check, .chatListItemReactionsContainer svg.fa-check");
    for (const m of list) {
      const li = document.createElement("li");
      li.className = "chatMembersPopoverListItem";
      li.innerHTML =
        '<div class="chatMembersPopoverListItem__avatar"><div class="avatarBox"></div></div><p class="chatMembersPopoverListItem__name"></p>' +
        (m.checked ? '<div class="chatMembersPopoverListItem__chk"><span class="stock-plus-rx-check">✓</span></div>' : "");
      if (m.checked && checkIcon) li.querySelector(".chatMembersPopoverListItem__chk").replaceChildren(checkIcon.cloneNode(true));
      if (m.avatar) li.querySelector(".avatarBox").style.backgroundImage = `url("${m.avatar.replace(/"/g, "%22")}")`;
      li.querySelector(".chatMembersPopoverListItem__name").textContent = m.name;
      ul.appendChild(li);
    }
    el.querySelector(".chatMembersPopover__closeBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      closePopover();
    });
    el.style.visibility = "hidden";
    document.body.appendChild(el);
    const a = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = Math.min(a.left, window.innerWidth - w - 8);
    left = Math.max(8, left);
    let top = a.top - h - 8;
    if (top < 8) top = a.bottom + 8;
    el.style.setProperty("left", `${left + window.scrollX}px`, "important");
    el.style.setProperty("top", `${top + window.scrollY}px`, "important");
    el.style.visibility = "";
    openPopover = { el, anchor };
  }

  // ---------- 操作 ----------
  async function addReaction(item, type) {
    const t = TYPES[type];
    const name = posterName(item);
    const quote = name ? `> ${name}さん「${snippetOf(item)}」` : `> 「${snippetOf(item)}」`;
    await sendMessage(item, `${t.emoji} ${t.label}${encodeTag(type, item.dataset.chatId)}\n${quote}`);
  }

  async function removeReaction(item, type) {
    const mine = myReaction(item.dataset.chatId, type);
    if (!mine) return;
    for (const mid of mine.markerIds) {
      if (!(await deleteMarker(mid))) {
        toast("取り消せませんでした。ページを再読み込みしてからお試しください。");
        return;
      }
    }
  }

  async function toggle(item, type) {
    if (busy) return;
    busy = true;
    try {
      if (myReaction(item.dataset.chatId, type)) await removeReaction(item, type);
      else await addReaction(item, type);
    } finally {
      busy = false;
      schedule();
    }
  }

  document.addEventListener(
    "click",
    (e) => {
      if (!isEnabled()) return;
      const el = e.target.closest && e.target.closest("[data-stock-plus-rx-action]");
      if (!el) {
        if (openPopover && !openPopover.el.contains(e.target)) closePopover();
        return;
      }
      const item = el.closest(".chatListItem[data-chat-id]");
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      const type = el.dataset.stockPlusRxType;
      const action = el.dataset.stockPlusRxAction;
      if (action === "list") {
        showPopover(item, type, el);
      } else if (action === "toggle-or-list") {
        // Stock と同じ: 自分の投稿なら一覧、そうでなければ付ける／外す
        const meta = chatMeta(item);
        if (meta.userId != null && meta.userId === meta.meId) showPopover(item, type, el.nextElementSibling || el);
        else toggle(item, type);
      } else {
        toggle(item, type);
      }
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePopover();
  });
  window.addEventListener("resize", closePopover);
  document.addEventListener(
    "scroll",
    (e) => {
      if (openPopover && !(e.target instanceof Node && openPopover.el.contains(e.target))) closePopover();
    },
    true
  );

  // ---------- トースト ----------
  let toastTimer;
  function toast(msg, ms = 3000) {
    let el = document.getElementById("stock-plus-rx-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "stock-plus-rx-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("stock-plus-rx-toast--show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("stock-plus-rx-toast--show"), ms);
  }

  // ---------- 監視 ----------
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      try {
        refresh();
      } catch (err) {
        console.error('[Stock Plus] feature "thanks-done-reactions" refresh failed', err);
      }
    }, 120);
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  // ON/OFF・オプションの切り替え（isolated world 側が <html> の属性を書き換える）を即時反映
  new MutationObserver(schedule).observe(ROOT, {
    attributes: true,
    attributeFilter: ["data-stock-plus-reactions", "data-stock-plus-reactions-hide-unread"],
  });
  schedule();
})();
