# 実装書(05): Notion マッパー — ページ⇔ドメインオブジェクト変換

- **依存**: 01(型)、04(NotionPage型のimport元)
- **対象ファイル**: `src/utils/notionMapper.ts`(**新規作成**)

## 目的

Notion APIのページオブジェクト(propertiesのネスト構造)と、アプリ内で使うフラットなドメイン型(`src/types.ts`)の相互変換を1箇所に集約する。**サービス層にNotionのプロパティ構造を漏らさない。**

## 1. 実装内容

```ts
import { NOTION_PROPS, USER_STATUS } from '../config';
import type { NotionPage } from '../clients/notionClient';
import type { InventoryItem, User, Purchase } from '../types';

/** InventoryItemの部分更新入力 */
export interface InventoryPropertiesInput {
  name?: string;
  inStock?: boolean;
  category?: string;
  stores?: string[];
  photoFileUpload?: { id: string; filename: string };
}

export const NotionMapper = {
  toInventoryItem(page: NotionPage): InventoryItem { ... },
  toUser(page: NotionPage): User { ... },
  toPurchase(page: NotionPage): Purchase { ... },
  /** 渡されたキーだけをNotionのpropertiesペイロードへ変換する(部分更新用) */
  buildInventoryProperties(partial: InventoryPropertiesInput): Record<string, unknown> { ... },
};
```

### 1.1 プリミティブ抽出ヘルパー(モジュール内・非export)

Notionの各プロパティ型から素の値を取り出す関数群。**プロパティが存在しない・空の場合は null / false / [] を返し、例外を投げない**こと(Notion側でプロパティが未設定のページに耐える)。

```ts
const propTitle = (page: NotionPage, name: string): string        // plain_textを連結。なければ ''
const propCheckbox = (page: NotionPage, name: string): boolean    // 未定義はfalse
const propSelect = (page: NotionPage, name: string): string | null
const propMultiSelect = (page: NotionPage, name: string): string[]
const propRichText = (page: NotionPage, name: string): string
const propDate = (page: NotionPage, name: string): string | null      // date.start の 'YYYY-MM-DD' 部分
const propRollupDate = (page: NotionPage, name: string): string | null // rollup.type==='date' → date.start
const propFilesFirstUrl = (page: NotionPage, name: string): string | null // 下記仕様
const propRelationIds = (page: NotionPage, name: string): string[]
```

`propFilesFirstUrl` の仕様: files配列の先頭要素について
- `type === 'file'`(Notionアップロード)→ `file.url`
- `type === 'external'` → `external.url`
- 空配列 → `null`

> 注意: `type:'file'` のURLは**1時間で失効する署名付きURL**。Flexメッセージのサムネイルには取得直後に使う分には問題ないが、URLを保存してはいけない。

### 1.2 `toInventoryItem(page)`

```ts
const P = NOTION_PROPS.INVENTORY;
return {
  pageId: page.id,
  name: propTitle(page, P.NAME),
  inStock: propCheckbox(page, P.IN_STOCK),
  category: propSelect(page, P.CATEGORY),
  photoUrl: propFilesFirstUrl(page, P.PHOTO),
  stores: propMultiSelect(page, P.STORES),
  memo: propRichText(page, P.MEMO) || null,  // 空文字はnullに正規化
  lastPurchasedAt: propRollupDate(page, P.LAST_PURCHASED),
};
```

### 1.3 `toUser(page)`

```ts
const P = NOTION_PROPS.USERS;
return {
  pageId: page.id,
  name: propTitle(page, P.NAME),
  lineUserId: propRichText(page, P.LINE_USER_ID),
  active: propSelect(page, P.STATUS) === USER_STATUS.ACTIVE,
};
```

### 1.4 `toPurchase(page)`

```ts
const P = NOTION_PROPS.PURCHASES;
return {
  pageId: page.id,
  itemPageId: propRelationIds(page, P.ITEM)[0] ?? null,
  purchasedAt: propDate(page, P.PURCHASED_AT),
  store: propSelect(page, P.STORE),
};
```

### 1.5 `buildInventoryProperties(partial)`

| partialのキー | 生成するプロパティ |
| --- | --- |
| `name` | `{ [P.NAME]: { title: [{ text: { content: name } }] } }` |
| `inStock` | `{ [P.IN_STOCK]: { checkbox: inStock } }` |
| `category` | `{ [P.CATEGORY]: { select: { name: category } } }` |
| `stores` | `{ [P.STORES]: { multi_select: stores.map((s) => ({ name: s })) } }` |
| `photoFileUpload` | `{ [P.PHOTO]: { files: [{ type: 'file_upload', name: filename, file_upload: { id } }] } }` |

- `undefined` のキーは出力に含めない(`inStock` は `false` も有効値なので `partial.inStock !== undefined` で判定)。
- `buildInventoryProperties({})` は `{}` を返す。
- プロパティ名はcomputed property name(`[P.NAME]:`)で `NOTION_PROPS` から取り、リテラル直書きしない。

## 2. 受け入れ基準

- [ ] 4つの公開メソッド+抽出ヘルパーが実装されている(ヘルパーは非export)。
- [ ] プロパティ未設定・空のページを渡しても例外にならず、null/false/[]になる。
- [ ] プロパティ名のリテラル直書きがない(すべて `NOTION_PROPS` 経由)。
- [ ] `buildInventoryProperties({})` が `{}`、`{ inStock: false }` がcheckboxプロパティを含む。
- [ ] `npm run typecheck` が通る。

## 3. 動作確認方法

Notion APIを呼ばずに固定のページオブジェクトで確認できる:

```ts
export const test_mapper = (): void => {
  const page: NotionPage = {
    id: 'page-id',
    properties: {
      '品名': { type: 'title', title: [{ plain_text: '食器用洗剤' }] },
      '在庫あり': { type: 'checkbox', checkbox: true },
      'カテゴリ': { type: 'select', select: { name: '洗剤' } },
      '購入先': { type: 'multi_select', multi_select: [{ name: 'スーパー' }, { name: 'Amazon' }] },
    },
  };
  logInfo('test', NotionMapper.toInventoryItem(page));
  // → {pageId:'page-id', name:'食器用洗剤', inStock:true, category:'洗剤',
  //    photoUrl:null, stores:['スーパー','Amazon'], memo:null, lastPurchasedAt:null}
};
```
