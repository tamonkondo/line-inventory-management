# 実装書(07): 在庫サービス(boolean管理)

- **依存**: 04, 05
- **対象ファイル**: `src/services/inventoryService.ts`(新規)。旧 `src/services/inventoryService.js`(数量ベースの雛形)を削除

## 目的

在庫の参照・登録・状態変更(在庫あり/切れ)・限定編集を実装する。
**雛形にあった数量ベースのメソッド(add/consume)は作らない**(R-08)。

## 1. 実装内容

計画書00 §5.2 のシグネチャに従う。重複エラーは `DUPLICATE_ITEM` という message の `Error` で表現する(呼び出し側が `err.message === 'DUPLICATE_ITEM'` で分岐)。

```ts
import { CONFIG, NOTION_PROPS } from '../config';
import { NotionClient } from '../clients/notionClient';
import { NotionMapper } from '../utils/notionMapper';
import { logError } from '../utils/logger';
import type { InventoryItem } from '../types';

const P = NOTION_PROPS.INVENTORY;
const DB_ID = () => CONFIG.NOTION_INVENTORY_DB_ID;

const defaultSorts = [
  { property: P.CATEGORY, direction: 'ascending' },
  { property: P.NAME, direction: 'ascending' },
];

export const InventoryService = {
  list(): InventoryItem[] { ... },
  listShortage(): InventoryItem[] { ... },
  search(keyword: string): InventoryItem[] { ... },
  findByName(name: string): InventoryItem | null { ... },
  getByPageId(pageId: string): InventoryItem | null { ... },
  create(input: { name: string; category?: string; stores?: string[] }): InventoryItem { ... },
  setInStock(pageId: string, inStock: boolean): void { ... },
  updateName(pageId: string, newName: string): void { ... },
  updateStores(pageId: string, stores: string[]): void { ... },
  attachPhoto(pageId: string, fileUploadId: string, filename: string): void { ... },
};
```

### 1.1 `list()`

- `NotionClient.queryAll(DB_ID(), { sorts: defaultSorts })` → `pages.map((p) => NotionMapper.toInventoryItem(p))`。

### 1.2 `listShortage()`

- フィルタ: `{ property: P.IN_STOCK, checkbox: { equals: false } }` + defaultSorts。

### 1.3 `search(keyword)`

- フィルタ: `{ property: P.NAME, title: { contains: keyword } }` + defaultSorts。

### 1.4 `findByName(name)`

- フィルタ: `{ property: P.NAME, title: { equals: name } }`、`page_size: 2`。
- 0件 → `null`。
- 2件以上 → `logError('InventoryService', \`同名品目が複数: ${name}\`)` して**先頭を返す**。

### 1.5 `getByPageId(pageId)`

- `NotionClient.retrievePage(pageId)` → mapper変換。404系の例外はそのまま伝播でよい。

### 1.6 `create(input)`

- **事前チェック**: `findByName(input.name)` が非nullなら `throw new Error('DUPLICATE_ITEM')`。
- ページ作成。在庫ありは **true で作成**(登録=買ってある前提。なければ直後に「なくなった」報告すればよい):
  ```ts
  const page = NotionClient.createPage({
    parent: { database_id: DB_ID() },
    properties: NotionMapper.buildInventoryProperties({
      name: input.name,
      inStock: true,
      ...(input.category ? { category: input.category } : {}),
      ...(input.stores ? { stores: input.stores } : {}),
    }),
  });
  return NotionMapper.toInventoryItem(page);
  ```

### 1.7 更新系(`setInStock` / `updateName` / `updateStores` / `attachPhoto`)

いずれも `NotionClient.updatePage(pageId, { properties: NotionMapper.buildInventoryProperties(...) })` の薄い実装。

- `updateName`: 変更前に `findByName(newName)` で重複チェックし、**pageIdが異なる**既存ページがあれば `throw new Error('DUPLICATE_ITEM')`。
- `updateStores(pageId, stores)`: **全置換**(Multi-selectにない選択肢名を渡すとNotionが自動で選択肢を作る。それで良い)。
- `attachPhoto(pageId, fileUploadId, filename)`: `photoFileUpload: { id: fileUploadId, filename }` を渡す。既存写真は**置き換え**(1枚運用)。

## 2. エッジケース

| ケース | 挙動 |
| --- | --- |
| 品目0件でlist | 空配列(呼び出し側が「まだ何も登録されていません」を返す) |
| 同名複数 | 先頭を使いエラーログ(運用でNotion側を直す) |
| create/updateNameの重複 | `Error('DUPLICATE_ITEM')` を投げる |
| Notion API失敗 | NotionClientの例外をそのまま伝播(ハンドラ層で捕捉) |

## 3. 受け入れ基準

- [ ] `add` / `consume` に相当するメソッドが存在しない(数量の概念がコードにない)。
- [ ] `listShortage()` が checkbox=false のみを返す。
- [ ] `create` が重複名で `DUPLICATE_ITEM` を投げ、正常時は inStock=true のページを作る。
- [ ] `setInStock(pageId, false)` でNotion画面のチェックが外れる。
- [ ] プロパティ名のリテラル直書きがない。`npm run typecheck` が通る。

## 4. 動作確認方法

Notion在庫DBに手で2〜3品目入れた状態で:

```ts
export const test_inventory = (): void => {
  logInfo('list', InventoryService.list().map((i) => `${i.name}:${i.inStock}`));
  const item = InventoryService.findByName('食器用洗剤');
  if (!item) throw new Error('テストデータがありません');
  InventoryService.setInStock(item.pageId, false);
  logInfo('shortage', InventoryService.listShortage().map((i) => i.name));
  InventoryService.setInStock(item.pageId, true);
};
```
