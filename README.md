# Stock Plus

[Stock](https://www.stock-app.jp/)（情報ストックツール）をブラウザ上で拡張するChrome拡張ツールキットです。
個別の機能を **feature モジュール** として追加していく構成のため、今後のアップデートで
メッセージ機能以外の拡張も同じ枠組みで追加できます。

## 機能

### ✓ 返答済みメッセージトラッキング（feature: `replied-messages`）

- メッセージへの **送信/返信操作を自動検知** し、宛先（トーク相手・スレッド名）を記録します。
- メッセージ一覧の項目に **「✓ 返答済み」バッジ** を表示します。
- 画面右下のフローティングボタン（✓）から、**自身が返答したメッセージの宛先一覧**を
  時系列（新しい順）で確認できます。各行から該当スレッドへ移動できます。
- 記録は **ページのlocalStorage** に保存され、**30日（約1ヶ月）で自動削除** されます。
  外部サーバへの送信は一切ありません。

## インストール（開発者モード）

1. このリポジトリをcloneする
2. Chromeで `chrome://extensions` を開く
3. 右上の「デベロッパーモード」をON
4. 「パッケージ化されていない拡張機能を読み込む」→ このリポジトリのルートを選択
5. Stock（stock-app.jp）を開く／リロードする

## ディレクトリ構成

```
stock-plus/
├── manifest.json              # Manifest V3
└── src/
    ├── content.js             # エントリポイント（全featureを起動）
    ├── core/
    │   ├── storage.js         # TTL付きlocalStorageラッパー（既定30日）
    │   └── featureManager.js  # feature登録・起動の仕組み
    ├── features/
    │   └── repliedMessages.js # 返答済みトラッキング機能
    └── styles/
        └── stock-plus.css
```

## 新しい機能の追加方法

1. `src/features/` に新しいJSファイルを作成し、以下の形で登録する:

   ```js
   window.StockPlus.registerFeature({
     id: "my-new-feature",
     name: "新機能の説明",
     init() { /* 初期化処理 */ },
   });
   ```

2. `manifest.json` の `content_scripts.js` に、`src/content.js` より **前** の位置で
   ファイルパスを追加する。

## 注意事項・チューニング

- StockはSPAのため、画面のDOM構造変更に追従できるよう、DOMセレクタ類は
  `src/features/repliedMessages.js` 冒頭の `SELECTORS` に集約しています。
  バッジが付かない・宛先名が取れない場合は、実際のDOMに合わせてここを調整してください。
- 送信検知はヒューリスティック（「送信/返信」ボタンのクリック、入力欄でのEnter送信）です。
  Stock側のUI文言が変わった場合は `SELECTORS.sendButtonText` を更新してください。
- 記録の削除はパネル右上の「全削除」から行えます。
