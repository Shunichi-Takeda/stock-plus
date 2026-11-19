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
    id: "favorite-folders",
    name: "お気に入りのフォルダ",
    description: "フォルダを ★（左メニュー・一覧の見出し）でお気に入り登録し、左メニューの「お気に入りのフォルダ」から一覧表示",
  },
  {
    id: "send-confirm",
    name: "大人数チャットの送信確認",
    description: "参加者がしきい値以上のチャットでメンション無し／@Allのとき、送信ボタンを「確認」→「送信」の二段構えに",
    // 数値オプション（featureOptions に保存）
    option: { key: "sendConfirmThreshold", label: "しきい値", unit: "名以上", default: 10, min: 1, max: 999 },
  },
  {
    id: "take-on-task",
    name: "「対応します！」ボタン",
    description: "メッセージの操作ボタン列の下に追加。「了解しました」と、誰が何に対応するか分かる名前のタスク作成を同時に実行",
    // 真偽オプション（featureOptions に保存。どちらもデフォルトOFF）
    options: [
      { key: "takeOnReplaceAck", type: "checkbox", label: "「了解しました」を「対応します！」に置き換える", default: false },
      { key: "takeOnReopen", type: "checkbox", label: "作成後にタスクを開く（編集画面）", default: false },
    ],
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

    // オプション（ON/OFFの下に表示）。type: "checkbox" は真偽、それ以外は数値。
    // 単一は option、複数は options で指定する
    const featureOpts = feature.options || (feature.option ? [feature.option] : []);
    for (const opt of featureOpts) {
      const row = document.createElement("div");
      row.className = "feature-option";

      if (opt.type === "checkbox") {
        const optLabel = document.createElement("label");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = featureOptions[opt.key] ?? opt.default;
        box.disabled = !checkbox.checked;
        optLabel.appendChild(box);
        optLabel.appendChild(document.createTextNode(opt.label));
        row.appendChild(optLabel);
        li.appendChild(row);

        box.addEventListener("change", () => {
          chrome.storage.sync.get({ featureOptions: {} }, (res) => {
            const next = res.featureOptions || {};
            next[opt.key] = box.checked;
            chrome.storage.sync.set({ featureOptions: next });
          });
        });
        checkbox.addEventListener("change", () => { box.disabled = !checkbox.checked; });
      } else {
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
    }
    list.appendChild(li);
  }
});

// 実行中のバージョン（更新が反映されているかの確認用）
document.getElementById("version").textContent =
  "Stock Plus v" + chrome.runtime.getManifest().version;
