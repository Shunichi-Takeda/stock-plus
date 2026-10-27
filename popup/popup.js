/**
 * Stock Plus - 設定ポップアップ
 * 機能ごとのON/OFFを chrome.storage.sync の featureSettings に保存する。
 * 未設定の機能はON（デフォルトON）。
 */
"use strict";

/** 設定ID・表示名の定義（content script側の isFeatureEnabled のIDと対応） */
const FEATURES = [
  {
    id: "replied",
    name: "「返信済み」フィルタ",
    description: "返信したメッセージを記録し、一覧をバッジ表示・絞り込み",
  },
  {
    id: "mentioned",
    name: "「@me」フィルタ",
    description: "自分宛メンションのあるメッセージを開いたら記録し、絞り込み",
  },
  {
    id: "chatroom-pin",
    name: "チャット画面のピン留めボタン",
    description: "チャットウィンドウのヘッダーからピン留めを切り替え",
  },
  {
    id: "template-filter",
    name: "テンプレート一覧の絞り込み",
    description: "テンプレート選択時に名前で絞り込むテキストフィールドを追加",
  },
  {
    id: "reply-all-mentions",
    name: "全員に返信（メンション引き継ぎ）",
    description: "返信時に元メッセージの全メンションを入力欄へ追記（自分個人宛と@Allは除外）",
  },
  {
    id: "favorite-stocks",
    name: "お気に入りの記事",
    description: "記事を ★ でお気に入り登録し、左メニューの「お気に入りの記事」から一覧表示",
  },
  {
    id: "send-confirm",
    name: "大人数チャットの送信確認",
    description: "参加者がしきい値以上のチャットでメンション無し／@Allのとき、送信ボタンを「確認」→「送信」の二段構えに",
    // 数値オプション（featureOptions に保存）
    option: { key: "sendConfirmThreshold", label: "しきい値", unit: "名以上", default: 10, min: 1, max: 999 },
  },
];

const list = document.getElementById("feature-list");

chrome.storage.sync.get({ featureSettings: {}, featureOptions: {} }, ({ featureSettings, featureOptions }) => {
  for (const feature of FEATURES) {
    const li = document.createElement("li");

    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = featureSettings[feature.id] !== false; // デフォルトON

    const body = document.createElement("span");
    body.className = "feature-body";
    const name = document.createElement("span");
    name.className = "feature-name";
    name.textContent = feature.name;
    const desc = document.createElement("span");
    desc.className = "feature-desc";
    desc.textContent = feature.description;
    body.appendChild(name);
    body.appendChild(desc);

    checkbox.addEventListener("change", () => {
      chrome.storage.sync.get({ featureSettings: {} }, (res) => {
        const next = res.featureSettings || {};
        next[feature.id] = checkbox.checked;
        chrome.storage.sync.set({ featureSettings: next });
      });
    });

    label.appendChild(checkbox);
    label.appendChild(body);
    li.appendChild(label);

    // 数値オプション（ON/OFFの下に「しきい値: [10] 名以上」の形で表示）
    if (feature.option) {
      const opt = feature.option;
      const row = document.createElement("div");
      row.className = "feature-option";
      const optLabel = document.createElement("span");
      optLabel.textContent = opt.label + ":";
      const input = document.createElement("input");
      input.type = "number";
      input.min = String(opt.min);
      input.max = String(opt.max);
      input.value = String(featureOptions[opt.key] ?? opt.default);
      input.disabled = !checkbox.checked;
      const unit = document.createElement("span");
      unit.textContent = opt.unit;
      row.appendChild(optLabel);
      row.appendChild(input);
      row.appendChild(unit);
      li.appendChild(row);

      const save = () => {
        let v = parseInt(input.value, 10);
        if (!Number.isFinite(v)) v = opt.default;
        v = Math.min(opt.max, Math.max(opt.min, v));
        input.value = String(v);
        chrome.storage.sync.get({ featureOptions: {} }, (res) => {
          const next = res.featureOptions || {};
          next[opt.key] = v;
          chrome.storage.sync.set({ featureOptions: next });
        });
      };
      input.addEventListener("change", save);
      input.addEventListener("blur", save);
      checkbox.addEventListener("change", () => { input.disabled = !checkbox.checked; });
    }
    list.appendChild(li);
  }
});
