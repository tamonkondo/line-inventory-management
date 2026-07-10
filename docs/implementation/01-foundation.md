# 実装書(01): 共通基盤 — TSビルド基盤・types・config・logger

- **依存**: なし(最初に着手する)
- **対象ファイル**:
  - ビルド基盤: `package.json`(更新)、`tsconfig.json`(新規)、`esbuild.mjs`(新規)、`.claspignore`(削除)
  - ソース: `src/index.ts`(新規)、`src/types.ts`(新規)、`src/config.ts`(新規)、`src/utils/logger.ts`(新規)
  - 既存の `src/**/*.js` 雛形は、**対応する `.ts` を実装するタスクの中で削除**する(本タスクでは `config.js` と `utils/logger.js` を削除)

## 目的

TypeScript+esbuildのビルドパイプラインを確立し、全モジュールが参照する型・設定値・Notionプロパティ名定数・ログ関数を整備する。**このタスク完了時点で `npm run push` がGASに反映できること**が最重要。

## 1. ビルド基盤

### 1.1 `package.json`

```json
{
  "name": "line-inventory-management",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "login": "clasp login",
    "typecheck": "tsc --noEmit",
    "build": "node esbuild.mjs && cp appsscript.json dist/",
    "push": "npm run build && clasp push",
    "pull": "clasp pull",
    "deploy": "clasp deploy"
  },
  "devDependencies": {
    "@google/clasp": "^3.0.0",
    "@types/google-apps-script": "^1.0.0",
    "esbuild": "^0.25.0",
    "esbuild-gas-plugin": "^0.9.0",
    "typescript": "^5.5.0"
  }
}
```

### 1.2 `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2019",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "types": ["google-apps-script"]
  },
  "include": ["src/**/*.ts"]
}
```

### 1.3 `esbuild.mjs`

```js
import { build } from 'esbuild';
import { GasPlugin } from 'esbuild-gas-plugin';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outfile: 'dist/main.js',
  target: 'es2019',
  charset: 'utf8',
  plugins: [GasPlugin],
});
```

### 1.4 clasp設定

- `.claspignore` を**削除**する(pushするのは `dist/` のみになるため不要)。
- `.clasp.json`(git管理外)は `{ "scriptId": "<ID>", "rootDir": "dist" }` とする。実装書15の手順に記載済み。
- `.gitignore` に `dist/` と `.env` が入っていることを確認(設定済み)。

### 1.5 `src/index.ts`(GASへの公開点)

esbuild-gas-plugin は `global` に代入された関数だけをGASのトップレベル関数として出力する。**ここに書かないとGASエディタ・Webhookから見えない。**

```ts
import { doGet, doPost } from './main';
import { setupRichMenu, listRichMenus, deleteRichMenu } from './setup/richMenuSetup';

declare const global: Record<string, unknown>;

// Webhook エンドポイント
global.doPost = doPost;
global.doGet = doGet;

// セットアップ用(GASエディタから手動実行)
global.setupRichMenu = setupRichMenu;
global.listRichMenus = listRichMenus;
global.deleteRichMenu = deleteRichMenu;
```

- 本タスク時点では `main.ts` / `richMenuSetup.ts` が未実装のため、**一時的に空実装のプレースホルダを置いてビルドを通す**(該当タスクで置き換える):
  ```ts
  // src/main.ts(実装書02で置き換え)
  export const doPost = (e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput =>
    ContentService.createTextOutput('OK');
  export const doGet = (): GoogleAppsScript.Content.TextOutput =>
    ContentService.createTextOutput('LINE Inventory Bot is running.');
  ```
- 動作確認用のテスト関数(各実装書の `test_*`)も、実機で実行する間だけ `global.test_xxx = test_xxx;` を index.ts に追記して使い、確認後に消す。

## 2. `src/types.ts`

**計画書00 §5.1 のコードをそのまま実装する**(契約なので改変しない)。

## 3. `src/config.ts`

```ts
const prop = (key: string): string => {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error(`Missing script property: ${key}`);
  return value;
};

/** スクリプトプロパティから機密値・設定値を読む(コード直書き禁止)。キー一覧は .env.example 参照 */
export const CONFIG = {
  get LINE_CHANNEL_ACCESS_TOKEN() { return prop('LINE_CHANNEL_ACCESS_TOKEN'); },
  get LINE_CHANNEL_SECRET()       { return prop('LINE_CHANNEL_SECRET'); },
  get NOTION_TOKEN()              { return prop('NOTION_TOKEN'); },
  get NOTION_INVENTORY_DB_ID()    { return prop('NOTION_INVENTORY_DB_ID'); },
  get NOTION_USERS_DB_ID()        { return prop('NOTION_USERS_DB_ID'); },
  get NOTION_PURCHASES_DB_ID()    { return prop('NOTION_PURCHASES_DB_ID'); },
  get RICHMENU_IMAGE_FILE_ID()    { return prop('RICHMENU_IMAGE_FILE_ID'); },
};

/** Notion DBのプロパティ名(スキーマ変更時はここだけ直す)。docs/notion-schema.md と一致させる */
export const NOTION_PROPS = {
  INVENTORY: {
    NAME: '品名',                 // Title
    IN_STOCK: '在庫あり',         // Checkbox
    CATEGORY: 'カテゴリ',         // Select
    PHOTO: '写真',                // Files & media
    STORES: '購入先',             // Multi-select
    LAST_PURCHASED: '最終購入日', // Rollup(date)
    PURCHASES: '購入履歴',        // Relation → PurchaseHistory
    LOCATION: '保管場所',         // Select
    EXPIRY: '賞味期限',           // Date
    UPDATED_BY: '更新者',         // Relation → Users
  },
  USERS: {
    NAME: '表示名',               // Title
    LINE_USER_ID: 'LINE User ID', // Rich text
    STATUS: 'ステータス',         // Select('有効' | '無効')
    REGISTERED_AT: '登録日',      // Date
  },
  PURCHASES: {
    NAME: '名前',                 // Title
    ITEM: '対象品目',             // Relation → Inventory
    PURCHASED_AT: '購入日',       // Date
    STORE: '購入先',              // Select
    RECORDED_BY: '記録者',        // Relation → Users
  },
} as const;

/** ステータスSelectの値 */
export const USER_STATUS = { ACTIVE: '有効', INACTIVE: '無効' } as const;
```

> 旧 `config.js` と異なり、**未設定プロパティは例外にする**(nullを返して後段で不可解なエラーになるのを防ぐ)。

## 4. `src/utils/logger.ts`

```ts
const stringifyForLog = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
};

/** 情報ログを統一形式で出力する。 */
export const logInfo = (context: string, message: unknown): void => {
  console.log(`[INFO][${context}] ${stringifyForLog(message)}`);
};

/** エラーログを統一形式で出力する。 */
export const logError = (context: string, error: unknown): void => {
  const detail = error instanceof Error && error.stack ? error.stack : stringifyForLog(error);
  console.error(`[ERROR][${context}] ${detail}`);
};
```

- GAS V8では `console.log` / `console.error` がCloud Loggingに出る。`Logger.log` は使わない。
- トークン等の機密値をログに出さないこと。

## 5. 受け入れ基準

- [ ] `npm install` → `npm run typecheck` → `npm run build` がすべて成功し、`dist/main.js` と `dist/appsscript.json` が生成される。
- [ ] `dist/main.js` の先頭付近に `function doPost(` などトップレベル関数が生成されている(esbuild-gas-pluginの出力確認)。
- [ ] `npm run push` でGASに反映され、Webアプリの `doGet` が「LINE Inventory Bot is running.」を返す。
- [ ] `src/types.ts` が計画書00 §5.1 と一致。
- [ ] `CONFIG` が未設定キーで例外を投げる。`NOTION_PROPS` / `USER_STATUS` が `as const` で定義され、`docs/notion-schema.md` の名前と一致。
- [ ] 置き換え済みの旧 `.js`(`src/config.js`, `src/utils/logger.js`)が削除されている。
- [ ] `src/` に `var` 宣言がない。

## 6. 動作確認方法

```ts
// 一時的に index.ts へ global.test_foundation = test_foundation; を追加して実行
import { logInfo, logError } from './utils/logger';
import { NOTION_PROPS } from './config';

export const test_foundation = (): void => {
  logInfo('test', { hello: 'world' });          // [INFO][test] {"hello":"world"}
  logError('test', new Error('sample'));        // スタックトレース付き
  logInfo('props', NOTION_PROPS.INVENTORY.NAME); // 品名
};
```
