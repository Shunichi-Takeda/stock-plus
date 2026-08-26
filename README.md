# Stock Plus

[Stock](https://www.stock-app.jp/)（情報ストックツール）をブラウザ上で拡張するChrome拡張ツールキットです。
個別の機能を **feature モジュール** として追加していく構成のため、今後のアップデートで
メッセージ機能以外の拡張も同じ枠組みで追加できます。

## 機能

### ✓ 返答済みメッセージトラッキング（feature: `replied-messages`）

- メッセージへの **送信操作を自動検知** し、宛先（トーク相手・グループ名）を記録します。
  検知対象は「送信」ボタンのクリック、入力欄での Cmd+Enter / Ctrl+Enter、
  および各メッセージの **「了解しました」ボタン** のクリックです。
- メッセージ一覧（チャットグループモーダル）の宛先名の横に **「✓ 返答済み」バッジ** を表示します。
- 一覧のタブ行（すべて／ノートに紐づく／ノートに紐づかない）の右に、太字の
  **「返信済み」フィルタリンク** を追加します。クリックすると一覧が
  「自分が返信したことのあるメッセージ」だけに絞り込まれます（再クリック、
  またはStock標準タブのクリックで解除）。件数は「返信済み(N)」として表示されます。
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

- DOMセレクタは実際のStockのDOM（2026-08時点で実機確認済み）に合わせています。
  主要セレクタ:
  - 一覧項目: `li.chatGroupListItem`（宛先名: `.chatGroupListItem__wrappedName` / `.chatGroupListItem__groupName`）
  - チャットウィンドウ: `.chatroom`（宛先名: `chatroom__nameBox__name*`、送信ボタン: `.chatroom__toolBar__sendBtn`、入力欄: `textarea.chatroom__messageTextArea`）
- Stock側のDOM変更時は `src/features/repliedMessages.js` 冒頭の `SELECTORS` だけ直せば追従できます。
- スレッドの識別は宛先名の完全一致で行います（Stock側にスレッドIDやURLが存在しないため）。
  宛先名を変更すると過去の記録とは別扱いになります。
- 記録の削除はパネル右上の「全削除」から行えます。
