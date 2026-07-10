# 実装書(05): Notion マッパー — ページ⇔ドメインオブジェクト変換

- **依存**: 01
- **対象ファイル**: `src/utils/notionMapper.js`(**新規作成**)

## 目的

Notion APIのページオブジェクト(propertiesのネスト構造)と、アプリ内で使うフラットなドメインオブジェクト(計画書00 §5.1)の相互変換を1箇所に集約する。**サービス層にNotionのプロパティ構造を漏らさない。**

## 1. 実装内容

```js
/** Notionページ⇔ドメインオブジェクトの変換(スキーマ依存はここに集約) */
var NotionMapper = {
  /** 在庫DBのページ → InventoryItem */
  toInventoryItem: function (page) { ... },
  /** ユーザーDBのページ → User */
  toUser: function (page) { ... },
  /** 購入履歴DBのページ → Purchase */
  toPurchase: function (page) { ... },
  /** InventoryItemの部分更新 → Notion propertiesペイロード */
  buildInventoryProperties: function (partial) { ... }
};
```

### 1.1 プリミティブ抽出ヘルパー(ファイル内プライベート)

Notionの各プロパティ型から素の値を取り出す関数群。**プロパティが存在しない・空の場合は null / false / [] を返し、例外を投げない**こと(Notion側でプロパティが未設定のページに耐える)。

```js
function propTitle_(page, name)       // → string(''なら'(名称未設定)'ではなく空文字でよい)
function propCheckbox_(page, name)    // → boolean(未定義はfalse)
function propSelect_(page, name)      // → string|null(select.name)
function propMultiSelect_(page, name) // → string[](multi_select[].name)
function propRichText_(page, name)    // → string(plain_textを連結)
function propDate_(page, name)        // → string|null(date.start の 'YYYY-MM-DD' 部分)
function propRollupDate_(page, name)  // → string|null(rollup.type==='date' → date.start)
function propFilesFirstUrl_(page, name) // → string|null(後述)
function propRelationIds_(page, name) // → string[](relation[].id)
```

`propFilesFirstUrl_` の仕様: files配列の先頭要素について
- `type === 'file'`(Notionアップロード)→ `file.url`
- `type === 'external'` → `external.url`
- 空配列 → `null`

> 注意: `type:'file'` のURLは**1時間で失効する署名付きURL**。Flexメッセージのサムネイルには取得直後に使う分には問題ないが、URLを保存してはいけない。

### 1.2 `toInventoryItem(page)`

```js
{
  pageId: page.id,
  name: propTitle_(page, NOTION_PROPS.INVENTORY.NAME),
  inStock: propCheckbox_(page, NOTION_PROPS.INVENTORY.IN_STOCK),
  category: propSelect_(page, NOTION_PROPS.INVENTORY.CATEGORY),
  photoUrl: propFilesFirstUrl_(page, NOTION_PROPS.INVENTORY.PHOTO),
  stores: propMultiSelect_(page, NOTION_PROPS.INVENTORY.STORES),
  location: propSelect_(page, NOTION_PROPS.INVENTORY.LOCATION),
  expiryDate: propDate_(page, NOTION_PROPS.INVENTORY.EXPIRY),
  lastPurchasedAt: propRollupDate_(page, NOTION_PROPS.INVENTORY.LAST_PURCHASED)
}
```

### 1.3 `toUser(page)`

```js
{
  pageId: page.id,
  name: propTitle_(page, NOTION_PROPS.USERS.NAME),
  lineUserId: propRichText_(page, NOTION_PROPS.USERS.LINE_USER_ID),
  active: propSelect_(page, NOTION_PROPS.USERS.STATUS) === USER_STATUS.ACTIVE
}
```

### 1.4 `toPurchase(page)`

```js
{
  pageId: page.id,
  itemPageId: propRelationIds_(page, NOTION_PROPS.PURCHASES.ITEM)[0] || null,
  purchasedAt: propDate_(page, NOTION_PROPS.PURCHASES.PURCHASED_AT),
  store: propSelect_(page, NOTION_PROPS.PURCHASES.STORE)
}
```

### 1.5 `buildInventoryProperties(partial)`

渡されたキーだけをNotionのpropertiesペイロードへ変換する(部分更新用)。

| partialのキー | 生成するプロパティ |
| --- | --- |
| `name: string` | `{品名: {title: [{text: {content: name}}]}}` |
| `inStock: boolean` | `{在庫あり: {checkbox: inStock}}` |
| `category: string` | `{カテゴリ: {select: {name: category}}}` |
| `stores: string[]` | `{購入先: {multi_select: stores.map(s => ({name: s}))}}` |
| `photoFileUploadId: {id, filename}` | `{写真: {files: [{type:'file_upload', name: filename, file_upload:{id}}]}}` |

※ プロパティ名はリテラルでなく必ず `NOTION_PROPS.INVENTORY.*` を使う(上表は概念表記)。
※ 未知のキーは無視。空オブジェクトを返してよい。

## 2. 受け入れ基準

- [ ] 4つの公開メソッド+抽出ヘルパーが実装されている。
- [ ] プロパティ未設定・空のページを渡しても例外にならず、null/false/[]になる。
- [ ] プロパティ名のリテラル直書きがない(すべて `NOTION_PROPS` 経由)。
- [ ] `buildInventoryProperties({})` が `{}` を返す。

## 3. 動作確認方法

Notion APIを呼ばずに固定のページJSONで確認できる:

```js
function test_mapper() {
  var page = {
    id: 'page-id',
    properties: {
      '品名': { type: 'title', title: [{ plain_text: '食器用洗剤', text: { content: '食器用洗剤' } }] },
      '在庫あり': { type: 'checkbox', checkbox: true },
      'カテゴリ': { type: 'select', select: { name: '洗剤' } },
      '購入先': { type: 'multi_select', multi_select: [{ name: 'スーパー' }, { name: 'Amazon' }] }
    }
  };
  var item = NotionMapper.toInventoryItem(page);
  logInfo('test', item);
  // → {pageId:'page-id', name:'食器用洗剤', inStock:true, category:'洗剤',
  //    photoUrl:null, stores:['スーパー','Amazon'], location:null, expiryDate:null, lastPurchasedAt:null}
}
```
