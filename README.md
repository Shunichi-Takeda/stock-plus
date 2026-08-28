# Stock Plus

## 概要

[Stock](https://www.stock-app.jp/)（情報ストックツール）をブラウザ上で拡張するChrome拡張ツールキットです。

Stock本体には無い便利機能を、ページに後付けで追加します。機能は独立したモジュール（feature）として実装されており、今後のアップデートでメッセージ機能以外の拡張も同じ枠組みで追加していけます。

## できるようになること

- **返信済みメッセージトラッキング**
  - 送信操作（送信ボタン / Enter / Cmd+Enter / Ctrl+Enter）と「了解しました」ボタンの自動検知
  - メッセージ一覧への「✓ 返答済み」バッジ表示
  - メッセージ一覧のタブ行に「**返信済み**」の一覧（フィルタ）を追加
  - 同じく「**@me**」の一覧（フィルタ）を追加（自分宛メンションのあるメッセージを開くと記録）
  - 記録はlocalStorageのみに保存され、30日で自動削除（外部送信なし）
- **チャット詳細画面のピン留めボタン**
  - 一覧にあるピン留めを、開いているチャットウィンドウのヘッダーからも切り替え可能に
- **テンプレート一覧の絞り込みフィルタ**
  - ノート作成時の「テンプレート一覧」に、テンプレート名で絞り込むテキストフィールドを追加

## 導入の仕方

1. このリポジトリをcloneします

   ```bash
   git clone <このリポジトリのURL>
   ```

2. Chromeで `chrome://extensions` を開きます
3. 右上の「**デベロッパーモード**」をONにします
4. 「**パッケージ化されていない拡張機能を読み込む**」をクリックし、cloneしたリポジトリのルートフォルダを選択します
5. Stock（stock-app.jp）を開きます（すでに開いている場合はタブをリロード）

以降、Stockのメッセージで返信すると自動的に記録が始まります。

### アップデートの反映

`git pull` などでコードを更新した場合は、`chrome://extensions` で Stock Plus の再読み込み（🔄）を行い、**Stockのタブもリロード**してください。

## ディレクトリ構成

```
stock-plus/
├── manifest.json              # Manifest V3
└── src/
    ├── content.js             # エントリポイント（全featureを起動）
    ├── core/
    │   ├── storage.js         # TTL付きlocalStorageラッパー（既定30日）
    │   └── featureManager.js  # feature登録・起動、インスタンスガード
    ├── features/
    │   └── repliedMessages.js # 返信済みトラッキング機能
    └── styles/
        └── stock-plus.css
```

## 新しい機能の追加方法

1. `src/features/` に新しいJSファイルを作成し、以下の形で登録します

   ```js
   window.StockPlus.registerFeature({
     id: "my-new-feature",
     name: "新機能の説明",
     init() { /* 初期化処理 */ },
   });
   ```

2. `manifest.json` の `content_scripts.js` に、`src/content.js` より **前** の位置でファイルパスを追加します

## 注意事項・チューニング

- DOMセレクタは実際のStockのDOM（2026-08時点で実機確認済み）に合わせています。
  Stock側のDOM変更時は `src/features/repliedMessages.js` 冒頭の `SELECTORS` だけ直せば追従できます
- スレッドの識別は宛先名ベースです（Stock側にスレッドIDやURLが存在しないため）。
  照合キーで多少の改名には追従しますが、タイトルを大きく変更すると過去の記録とは別扱いになります
- 記録の全削除は、返信済みフィルタ使用中に確認できる記録をリセットしたい場合に
  DevToolsから `localStorage.removeItem('stockPlus.repliedMessages')` で行えます
