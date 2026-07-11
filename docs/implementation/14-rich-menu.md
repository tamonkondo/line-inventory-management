# 実装書(14): リッチメニュー — 定義・登録スクリプト

- **依存**: 03
- **対象ファイル**: `assets/richmenu/richmenu.json`(実装)、`src/setup/richMenuSetup.ts`(**新規作成**。01のプレースホルダを置き換え)

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

## 3. `src/setup/richMenuSetup.ts`

TypeScriptなので **`assets/richmenu/richmenu.json` を `import` で取り込める**(esbuildがJSONをバンドルする)。二重管理は不要。

```ts
import richMenuDef from '../../assets/richmenu/richmenu.json';
import { CONFIG } from '../config';
import { logInfo } from '../utils/logger';

// ※ tsconfig.json に "resolveJsonModule": true を追加すること(このタスクで行う)

/** リッチメニュー登録用ワンショットスクリプト。GASエディタから手動実行する。 */

/** 1) メニュー作成 → 2) 画像アップロード → 3) デフォルト設定 を一括実行 */
export const setupRichMenu = (): void => {
  const richMenuId = createRichMenu();
  uploadRichMenuImage(richMenuId);
  setDefaultRichMenu(richMenuId);
  logInfo('setupRichMenu', `done: ${richMenuId}`);
};

/** 登録済みリッチメニューの一覧をログに出す */
export const listRichMenus = (): void => { ... };

/** 指定IDのリッチメニューを削除する(GASエディタから実行するため引数なし版も検討) */
export const deleteRichMenu = (richMenuId: string): void => { ... };
```

> GASエディタからは引数付き関数を直接実行できないため、`deleteRichMenu` は
> スクリプトプロパティや `listRichMenus` のログからIDをコピーして使う
> `deleteAllRichMenus()`(全削除)も用意しておくと作り直しが楽。

### 3.1 各ステップのAPI(非export関数として実装)

| ステップ | エンドポイント | 備考 |
| --- | --- | --- |
| 作成 `createRichMenu` | `POST https://api.line.me/v2/bot/richmenu`(JSON=richMenuDef) | レスポンスの `richMenuId` を返す |
| 画像 `uploadRichMenuImage` | `POST https://api-data.line.me/v2/bot/richmenu/{richMenuId}/content` | `contentType: 'image/png'`、payloadに画像Blobをそのまま。**ホストがapi-data**な点に注意 |
| デフォルト設定 `setDefaultRichMenu` | `POST https://api.line.me/v2/bot/user/all/richmenu/{richMenuId}` | 全ユーザーに適用 |
| 一覧 | `GET https://api.line.me/v2/bot/richmenu/list` | |
| 削除 | `DELETE https://api.line.me/v2/bot/richmenu/{richMenuId}` | |

- 作成・一覧・削除・デフォルト設定は `lineFetch`(実装書03でexport)を再利用する。
- 画像アップロードだけはcontentTypeが特殊なので個別に `UrlFetchApp.fetch` を書く。

画像の入手: スクリプトプロパティ `RICHMENU_IMAGE_FILE_ID`(Google DriveのファイルID)から
`DriveApp.getFileById(CONFIG.RICHMENU_IMAGE_FILE_ID).getBlob()` で取得する。
画像は 2500×1686 のPNG/JPEG(1MB以下)。デザインは §1 の区画に合わせて別途用意する(仮画像でも区画が分かればよい)。

### 3.2 実装上の注意

- `src/index.ts` の `global` 束縛(実装書01)に `setupRichMenu` / `listRichMenus` / `deleteAllRichMenus` が含まれていることを確認(なければ追加)。
- `DriveApp` を使うため、初回実行時にGASのスコープ承認ダイアログが出る(手動実行前提なので問題ない)。
- Webhook処理からは呼ばれない(セットアップ専用)。

## 4. 受け入れ基準

- [ ] `richmenu.json` の areas が6区画で、dataが実装書11の表と一致。
- [ ] `richmenu.json` をimportしており、メニュー定義の二重管理がない。
- [ ] `setupRichMenu()` 一発でメニューが作成され、実機のトーク画面下部に表示される。
- [ ] 各ボタンをタップすると対応するpostbackが飛ぶ(displayTextがトークに出る)。
- [ ] `listRichMenus()` / 削除関数で作り直しができる。
- [ ] `npm run typecheck` / `npm run build` が通る。

## 5. 動作確認方法

1. 仮画像をDriveに置き、ファイルIDをスクリプトプロパティに設定。
   **`assets/richmenu/richmenu-placeholder.png`(2500×1686・6区画のラベル入り)をそのまま使える。**
   本番用のデザイン画像に差し替える場合も同サイズ・同区画で作ること。
2. GASエディタで `setupRichMenu()` を実行。
3. 実機LINEでトークを開き、メニュー表示と6ボタンの動作を確認(ハンドラ実装前はpostbackが無反応でよい。Webhookログにイベントが届いていればOK)。
