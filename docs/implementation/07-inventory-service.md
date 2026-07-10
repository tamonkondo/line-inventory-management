# 実装書(07): 在庫サービス(boolean管理)

- **依存**: 04, 05
- **対象ファイル**: `src/services/inventoryService.js`(**全面書き換え**)

## 目的

在庫の参照・登録・状態変更(在庫あり/切れ)・限定編集を実装する。
**雛形にある数量ベースのメソッド(add/consume)は削除する**(R-08)。

## 1. 実装内容

計画書00 §5.2 のシグネチャに従う。

```js
/** 在庫の業務ロジック(boolean管理: R-08) */
var InventoryService = {
  list: function () { ... },
  listShortage: function () { ... },
  search: function (keyword) { ... },
  findByName: function (name) { ... },
  getByPageId: function (pageId) { ... },
  create: function (input) { ... },        // input = {name, category?, stores?}
  setInStock: function (pageId, inStock) { ... },
  updateName: function (pageId, newName) { ... },
  updateStores: function (pageId, stores) { ... },
  attachPhoto: function (pageId, fileUploadId, filename) { ... }
};
```

### 1.1 `list()`

- `NotionClient.queryAll(CONFIG.NOTION_INVENTORY_DB_ID, payload)` で全件取得。
- ソートはNotion側で指定:
  ```js
  sorts: [
    { property: NOTION_PROPS.INVENTORY.CATEGORY, direction: 'ascending' },
    { property: NOTION_PROPS.INVENTORY.NAME, direction: 'ascending' }
  ]
  ```
- `NotionMapper.toInventoryItem` で変換して返す。

### 1.2 `listShortage()`

- フィルタ: `{ property: 在庫あり, checkbox: { equals: false } }`
- ソートは list() と同じ。

### 1.3 `search(keyword)`

- フィルタ: `{ property: 品名, title: { contains: keyword } }`

### 1.4 `findByName(name)`

- フィルタ: `{ property: 品名, title: { equals: name } }`、`page_size: 2` で取得。
- 0件 → `null`。
- 2件以上 → `logError('InventoryService', '同名品目が複数: ' + name)` して**先頭を返す**。

### 1.5 `getByPageId(pageId)`

- `NotionClient.retrievePage(pageId)` → mapper変換。404系の例外はそのまま伝播でよい。

### 1.6 `create(input)`

- **事前チェック**: `findByName(input.name)` が非nullなら `throw new Error('DUPLICATE_ITEM')`(呼び出し側がこのメッセージで分岐して「既にあります」と返信する)。
- ページ作成。在庫ありは **true で作成**(登録=買ってある前提。なければ直後に「なくなった」報告すればよい):
  ```js
  properties: NotionMapper.buildInventoryProperties({
    name: input.name,
    inStock: true,
    category: input.category,   // 未指定なら省く
    stores: input.stores        // 未指定なら省く
  })
  ```
  ※ `buildInventoryProperties` は渡されたキーだけ変換する仕様(実装書05)。undefinedのキーは渡さないこと。
- 作成レスポンスを mapper で変換して返す。

### 1.7 `setInStock(pageId, inStock)` / `updateName` / `updateStores` / `attachPhoto`

いずれも `NotionClient.updatePage(pageId, { properties: NotionMapper.buildInventoryProperties(...) })` の薄い実装。

- `updateName`: 変更前に `findByName(newName)` で重複チェックし、別ページが存在すれば `throw new Error('DUPLICATE_ITEM')`。
- `updateStores(pageId, stores)`: **全置換**(Multi-selectにない選択肢名を渡すとNotionが自動で選択肢を作る。それで良い)。
- `attachPhoto(pageId, fileUploadId, filename)`: `photoFileUploadId: { id: fileUploadId, filename: filename }` を渡す。既存写真は**置き換え**(1枚運用)。

## 2. エッジケース

| ケース | 挙動 |
| --- | --- |
| 品目0件でlist | 空配列(呼び出し側が「まだ何も登録されていません」を返す) |
| 同名複数 | 先頭を使いエラーログ(運用でNotion側を直す) |
| create/updateNameの重複 | `Error('DUPLICATE_ITEM')` を投げる |
| Notion API失敗 | NotionClientの例外をそのまま伝播(ハンドラ層で捕捉) |

## 3. 受け入れ基準

- [ ] 雛形の `add` / `consume` が存在しない(数量の概念がコードにない)。
- [ ] `listShortage()` が checkbox=false のみを返す。
- [ ] `create` が重複名で `DUPLICATE_ITEM` を投げ、正常時は inStock=true のページを作る。
- [ ] `setInStock(pageId, false)` でNotion画面のチェックが外れる。
- [ ] プロパティ名のリテラル直書きがない。

## 4. 動作確認方法

Notion在庫DBに手で2〜3品目入れた状態で、GASエディタから:

```js
function test_inventory() {
  logInfo('list', InventoryService.list().map(function(i){ return i.name + ':' + i.inStock; }));
  var item = InventoryService.findByName('食器用洗剤');
  InventoryService.setInStock(item.pageId, false);
  logInfo('shortage', InventoryService.listShortage().map(function(i){ return i.name; }));
  InventoryService.setInStock(item.pageId, true);
}
```
