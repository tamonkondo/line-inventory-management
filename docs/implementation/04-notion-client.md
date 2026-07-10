# 実装書(04): Notion API クライアント

- **依存**: 01
- **対象ファイル**: `src/clients/notionClient.js`(拡張)

## 目的

既存の汎用ラッパー(queryDatabase / createPage / updatePage)に、エラーハンドリング・pagination・ページ取得・**ファイルアップロード**を追加する。DBスキーマへの依存は持たせない。

## 1. `notionFetch_` の改修

既存実装はステータスコードを見ずに `JSON.parse` している。以下に改修する。

```js
function notionFetch_(method, path, payload) {
  var res = UrlFetchApp.fetch('https://api.notion.com/v1' + path, {
    method: method,
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.NOTION_TOKEN,
      'Notion-Version': '2022-06-28'
    },
    payload: payload ? JSON.stringify(payload) : null,
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  // レート制限(429)と一時エラー(5xx)は1回だけリトライ
  if (code === 429 || code >= 500) {
    Utilities.sleep(1500);
    res = UrlFetchApp.fetch('https://api.notion.com/v1' + path, /* 同一options */);
    code = res.getResponseCode();
  }
  if (code < 200 || code >= 300) {
    logError('NotionClient', method + ' ' + path + ' → ' + code + ' ' + res.getContentText());
    throw new Error('Notion API error: ' + code);
  }
  return JSON.parse(res.getContentText());
}
```

※ リトライで同一optionsを使うため、options組み立てを関数内で変数に括り出すこと。

## 2. メソッド追加

既存の `queryDatabase` / `createPage` / `updatePage` に加えて:

```js
/** ページ1件取得 */
retrievePage: function (pageId) {
  return notionFetch_('GET', '/pages/' + pageId, null);
},

/** queryDatabaseのpaginationを吸収して全ページ配列を返す */
queryAll: function (databaseId, payload) {
  var results = [];
  var cursor = null;
  do {
    var body = payload ? JSON.parse(JSON.stringify(payload)) : {};
    if (cursor) body.start_cursor = cursor;
    var res = this.queryDatabase(databaseId, body);
    results = results.concat(res.results || []);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return results;
},
```

## 3. ファイルアップロード(Notion File Upload API)

写真登録(実装書13)で使う。2段階:

1. **アップロード枠の作成**: `POST /v1/file_uploads`(JSON)
   - body: `{ "mode": "single_part", "filename": "<name>.jpg" }`
   - レスポンス: `{ id, upload_url, ... }`
2. **バイナリ送信**: `POST /v1/file_uploads/{id}/send`(**multipart/form-data**)
   - フォームフィールド名 `file` にバイナリを入れる。
   - GASでは `payload: { file: blob }` を渡すと UrlFetchApp が自動で multipart にする。**`contentType` は指定しない**こと(指定するとmultipartにならない)。

```js
/** LINE等から取得したBlobをNotionへアップロードし、file_upload IDを返す */
uploadFile: function (blob, filename) {
  var created = notionFetch_('POST', '/file_uploads', {
    mode: 'single_part',
    filename: filename
  });
  var res = UrlFetchApp.fetch('https://api.notion.com/v1/file_uploads/' + created.id + '/send', {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.NOTION_TOKEN,
      'Notion-Version': '2022-06-28'
    },
    payload: { file: blob.setName(filename) },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    logError('NotionClient.uploadFile', code + ' ' + res.getContentText());
    throw new Error('Notion file upload failed: ' + code);
  }
  return created.id;
}
```

アップロードしたファイルをページのFilesプロパティに添付する形式(参照用。添付処理自体はInventoryService側):

```json
{ "properties": { "写真": { "files": [
  { "type": "file_upload", "name": "photo.jpg", "file_upload": { "id": "<fileUploadId>" } }
] } } }
```

- single_part の上限は20MB。超えたら例外でよい(呼び出し側がユーザーに謝るメッセージを返す)。
- `file_uploads` エンドポイントが `Notion-Version: 2022-06-28` で弾かれる場合は、このリクエストに限りヘッダを新しい版(例: `2025-09-03`)へ上げる。**先に実挙動を確認してから決めること**(実装書15のセットアップ時に検証)。

## 4. 受け入れ基準

- [ ] 2xx以外で `logError` + 例外。429/5xxで1回リトライする。
- [ ] `retrievePage` / `queryAll` / `uploadFile` が追加されている。
- [ ] `queryAll` が `has_more` / `next_cursor` を正しく辿る(引数payloadを破壊しない)。
- [ ] `uploadFile` の `/send` リクエストで contentType を明示指定していない(multipartになる)。
- [ ] トークンがログに出ない。

## 5. 動作確認方法

スクリプトプロパティ設定+Notion DB作成後(実装書15):

```js
function test_notionQuery() {
  var pages = NotionClient.queryAll(CONFIG.NOTION_INVENTORY_DB_ID, {});
  logInfo('test', 'pages=' + pages.length);
}
function test_notionUpload() {
  var blob = Utilities.newBlob('hello', 'text/plain', 'hello.txt');
  var id = NotionClient.uploadFile(blob, 'hello.txt');
  logInfo('test', 'fileUploadId=' + id);
}
```
