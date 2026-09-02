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
    description: "返信時に元メッセージの全メンションを入力欄へ追記（自分宛は除外）",
  },
];

const list = document.getElementById("feature-list");

chrome.storage.sync.get({ featureSettings: {} }, ({ featureSettings }) => {
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
    list.appendChild(li);
  }
});
