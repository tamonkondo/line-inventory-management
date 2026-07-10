# 実装書(14): リッチメニュー — 定義・登録スクリプト

- **依存**: 03
- **対象ファイル**: `assets/richmenu/richmenu.json`(実装)、`src/setup/richMenuSetup.js`(**新規作成**)

## 目的

6ボタンのリッチメニュー(R-07)を定義し、GASから作成・画像アップロード・デフォルト設定できるようにする。

## 1. メニュー構成(2500×1686、3列×2行)

```
┌────────────┬────────────┬────────────┐
│ 📦 在庫一覧 │ ⚠️ 不足一覧 │ 😱 なくなった │   ← y: 0..843
├────────────┼────────────┼────────────┤
│ 🛒 買った   │ ➕ 新規登録 │ ❓ ヘルプ    │   ← y: 843..1686
└────────────┴────────────┴────────────┘
  x: 0..833     833..1666    1666..2500
```

## 2. `assets/richmenu/richmenu.json`

既存の雛形(size / name / chatBarText)を活かし、`areas` を埋める。

```json
{
  "size": { "width": 2500, "height": 1686 },
  "selected": true,
  "name": "inventory-menu-v1",
  "chatBarText": "在庫メニュー",
  "areas": [
    { "bounds": { "x": 0,    "y": 0,   "width": 833, "height": 843 },
      "action": { "type": "postback", "data": "action=list", "displayText": "在庫一覧" } },
    { "bounds": { "x": 833,  "y": 0,   "width": 833, "height": 843 },
      "action": { "type": "postback", "data": "action=shortage", "displayText": "不足一覧" } },
    { "bounds": { "x": 1666, "y": 0,   "width": 834, "height": 843 },
      "action": { "type": "postback", "data": "action=out&step=start", "displayText": "なくなった" } },
    { "bounds": { "x": 0,    "y": 843, "width": 833, "height": 843 },
      "action": { "type": "postback", "data": "action=buy&step=start", "displayText": "買った" } },
    { "bounds": { "x": 833,  "y": 843, "width": 833, "height": 843 },
      "action": { "type": "postback", "data": "action=new&step=start", "displayText": "新規登録" } },
    { "bounds": { "x": 1666, "y": 843, "width": 834, "height": 843 },
      "action": { "type": "postback", "data": "action=help", "displayText": "ヘルプ" } }
  ]
}
```

- `data` の値は実装書11の表と完全一致させること。
- `selected: true`(メニューを開いた状態で表示)。

## 3. `src/setup/richMenuSetup.js`

`.claspignore` の都合で `assets/` はGASに上がらないため、**同じ定義をJSオブジェクトとしてこのファイルにも持つ**(`RICHMENU_DEF` 定数)。`assets/richmenu/richmenu.json` が正で、変更時は両方を同期する旨をコメントに書く。

```js
/** リッチメニュー登録用ワンショットスクリプト。GASエディタから手動実行する。 */

var RICHMENU_DEF = { /* richmenu.json と同一内容 */ };

/** 1) メニュー作成 → 2) 画像アップロード → 3) デフォルト設定 を一括実行 */
function setupRichMenu() {
  var richMenuId = createRichMenu_();
  uploadRichMenuImage_(richMenuId);
  setDefaultRichMenu_(richMenuId);
  logInfo('setupRichMenu', 'done: ' + richMenuId);
}
```

### 3.1 各ステップのAPI

| ステップ | エンドポイント | 備考 |
| --- | --- | --- |
| 作成 | `POST https://api.line.me/v2/bot/richmenu`(JSON=RICHMENU_DEF) | レスポンスの `richMenuId` を使う |
| 画像 | `POST https://api-data.line.me/v2/bot/richmenu/{richMenuId}/content` | `contentType: 'image/png'`、payloadに画像Blobをそのまま。**ホストがapi-data**な点に注意 |
| デフォルト設定 | `POST https://api.line.me/v2/bot/user/all/richmenu/{richMenuId}` | 全ユーザーに適用 |

画像の入手: スクリプトプロパティ `RICHMENU_IMAGE_FILE_ID`(Google DriveのファイルID)から
`DriveApp.getFileById(CONFIG.RICHMENU_IMAGE_FILE_ID).getBlob()` で取得する。
画像は 2500×1686 のPNG/JPEG(1MB以下)。デザインは §1 の区画に合わせて別途用意する(仮画像でも区画が分かればよい)。

### 3.2 補助関数(掃除用)

```js
/** 登録済みリッチメニューの一覧をログに出す */
function listRichMenus() { /* GET /v2/bot/richmenu/list */ }
/** 指定IDのリッチメニューを削除する */
function deleteRichMenu(richMenuId) { /* DELETE /v2/bot/richmenu/{richMenuId} */ }
```

作り直しの際は list → delete → setup の順で使う。

### 3.3 実装上の注意

- このファイルのfetchは `lineFetch_`(実装書03)を再利用してよいが、画像アップロードだけはcontentTypeが特殊なので個別に `UrlFetchApp.fetch` を書く。
- `DriveApp` を使うため、初回実行時にGASのスコープ承認ダイアログが出る(手動実行前提なので問題ない)。
- Webhook処理からは呼ばれない(セットアップ専用)。

## 4. 受け入れ基準

- [ ] `richmenu.json` の areas が6区画で、dataが実装書11の表と一致。
- [ ] `setupRichMenu()` 一発でメニューが作成され、実機のトーク画面下部に表示される。
- [ ] 各ボタンをタップすると対応するpostbackが飛ぶ(displayTextがトークに出る)。
- [ ] `listRichMenus()` / `deleteRichMenu()` で作り直しができる。

## 5. 動作確認方法

1. 仮画像(区画線+ラベルだけでよい)をDriveに置き、ファイルIDをスクリプトプロパティに設定。
2. GASエディタで `setupRichMenu()` を実行。
3. 実機LINEでトークを開き、メニュー表示と6ボタンの動作を確認(ハンドラ実装前はpostbackが無反応でよい。Webhookログにイベントが届いていればOK)。
