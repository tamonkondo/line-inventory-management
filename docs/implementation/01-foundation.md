# 実装書(01): 共通基盤 — config・定数・logger

- **依存**: なし(最初に着手する)
- **対象ファイル**: `src/config.js`(拡張)、`src/utils/logger.js`(実装)

## 目的

全モジュールが参照する設定値・Notionプロパティ名定数・ログ関数を整備する。

## 1. `src/config.js` の拡張

既存の `CONFIG` に以下のgetterを**追加**する(既存のものは変更しない)。

```js
// 追加するスクリプトプロパティ
get NOTION_PURCHASES_DB_ID()  { return prop_('NOTION_PURCHASES_DB_ID'); }   // 購入履歴DB
get RICHMENU_IMAGE_FILE_ID()  { return prop_('RICHMENU_IMAGE_FILE_ID'); }   // リッチメニュー画像のDriveファイルID(実装書14で使用)
```

さらに、Notionのプロパティ名定数 `NOTION_PROPS` を同ファイルに追加する。
`docs/notion-schema.md` のプロパティ名と一致させること。

```js
/** Notion DBのプロパティ名(スキーマ変更時はここだけ直す) */
var NOTION_PROPS = {
  INVENTORY: {
    NAME: '品名',              // Title
    IN_STOCK: '在庫あり',      // Checkbox
    CATEGORY: 'カテゴリ',      // Select
    PHOTO: '写真',             // Files & media
    STORES: '購入先',          // Multi-select
    LAST_PURCHASED: '最終購入日', // Rollup(date)
    PURCHASES: '購入履歴',     // Relation → PurchaseHistory
    LOCATION: '保管場所',      // Select
    EXPIRY: '賞味期限',        // Date
    UPDATED_BY: '更新者'       // Relation → Users
  },
  USERS: {
    NAME: '表示名',            // Title
    LINE_USER_ID: 'LINE User ID', // Rich text
    STATUS: 'ステータス',      // Select('有効' | '無効')
    REGISTERED_AT: '登録日'    // Date
  },
  PURCHASES: {
    NAME: '名前',              // Title
    ITEM: '対象品目',          // Relation → Inventory
    PURCHASED_AT: '購入日',    // Date
    STORE: '購入先',           // Select
    RECORDED_BY: '記録者'      // Relation → Users
  }
};

/** ステータスSelectの値 */
var USER_STATUS = { ACTIVE: '有効', INACTIVE: '無効' };
```

## 2. `src/utils/logger.js` の実装

```js
/** 情報ログを統一形式で出力する。 */
function logInfo(context, message) {
  console.log('[INFO][' + context + '] ' + stringifyForLog_(message));
}

/** エラーログを統一形式で出力する。 */
function logError(context, error) {
  var detail = (error && error.stack) ? error.stack : stringifyForLog_(error);
  console.error('[ERROR][' + context + '] ' + detail);
}

function stringifyForLog_(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch (e) { return String(value); }
}
```

- GAS V8では `console.log` / `console.error` がStackdriver(Cloud Logging)に出る。`Logger.log` は使わない。
- トークン等の機密値をログに出さないこと(呼び出し側の責務だが、logger側でも値の自動展開はしない)。

## 3. 受け入れ基準

- [ ] `CONFIG.NOTION_PURCHASES_DB_ID` 等の追加getterが存在し、`prop_()` 経由で読む。
- [ ] `NOTION_PROPS` / `USER_STATUS` がグローバル定数として定義され、`docs/notion-schema.md` の名前と一致。
- [ ] `logInfo('test', {a:1})` がGASエディタ実行で `[INFO][test] {"a":1}` と出力される。
- [ ] `logError('test', new Error('x'))` でスタックトレースが出力される。
- [ ] 既存コードの動作を壊していない(`prop_` の重複定義をしない)。

## 4. 動作確認方法

GASエディタで以下のテスト関数を一時的に作って実行し、ログを確認(確認後削除してよい):

```js
function test_foundation() {
  logInfo('test', { hello: 'world' });
  logError('test', new Error('sample'));
  logInfo('props', NOTION_PROPS.INVENTORY.NAME); // → 品名
}
```
