# 実装書(04): Notion API クライアント

- **依存**: 01
- **対象ファイル**: `src/clients/notionClient.ts`(新規)。旧 `src/clients/notionClient.js` を削除

## 目的

Notion APIの汎用ラッパー(query / create / update / retrieve / pagination / **ファイルアップロード**)を実装する。DBスキーマへの依存は持たせない。

## 1. 型定義(このファイルで定義してexport)

Notion APIレスポンスの必要最小限の自前型。プロパティ値の詳細構造はmapper(実装書05)が扱うため、ここでは緩く保つ。

```ts
export interface NotionPage {
  id: string;
  properties: Record<string, NotionPropertyValue>;
}

/** プロパティ値(必要な型のみ。判別は type フィールドで行う) */
export interface NotionPropertyValue {
  type?: string;
  title?: Array<{ plain_text?: string; text?: { content: string } }>;
  rich_text?: Array<{ plain_text?: string }>;
  checkbox?: boolean;
  select?: { name: string } | null;
  multi_select?: Array<{ name: string }>;
  date?: { start: string } | null;
  files?: Array<{ type?: string; name?: string; file?: { url: string }; external?: { url: string } }>;
  relation?: Array<{ id: string }>;
  rollup?: { type?: string; date?: { start: string } | null };
}

export interface NotionQueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}
```

## 2. 共通fetch

```ts
import { CONFIG } from '../config';
import { logError } from '../utils/logger';

const NOTION_VERSION = '2022-06-28';

const notionFetch = <T>(method: 'get' | 'post' | 'patch', path: string, payload?: object): T => {
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method,
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${CONFIG.NOTION_TOKEN}`,
      'Notion-Version': NOTION_VERSION,
    },
    muteHttpExceptions: true,
    ...(payload ? { payload: JSON.stringify(payload) } : {}),
  };
  const url = `https://api.notion.com/v1${path}`;
  let res = UrlFetchApp.fetch(url, options);
  let code = res.getResponseCode();
  // レート制限(429)と一時エラー(5xx)は1回だけリトライ
  if (code === 429 || code >= 500) {
    Utilities.sleep(1500);
    res = UrlFetchApp.fetch(url, options);
    code = res.getResponseCode();
  }
  if (code < 200 || code >= 300) {
    logError('NotionClient', `${method} ${path} → ${code} ${res.getContentText()}`);
    throw new Error(`Notion API error: ${code}`);
  }
  return JSON.parse(res.getContentText()) as T;
};
```

## 3. 公開メソッド

```ts
export const NotionClient = {
  queryDatabase(databaseId: string, payload: object): NotionQueryResponse {
    return notionFetch<NotionQueryResponse>('post', `/databases/${databaseId}/query`, payload);
  },

  createPage(payload: object): NotionPage {
    return notionFetch<NotionPage>('post', '/pages', payload);
  },

  updatePage(pageId: string, payload: object): NotionPage {
    return notionFetch<NotionPage>('patch', `/pages/${pageId}`, payload);
  },

  retrievePage(pageId: string): NotionPage {
    return notionFetch<NotionPage>('get', `/pages/${pageId}`);
  },

  /** queryDatabaseのpaginationを吸収して全ページ配列を返す(引数payloadは破壊しない) */
  queryAll(databaseId: string, payload?: object): NotionPage[] {
    const results: NotionPage[] = [];
    let cursor: string | null = null;
    do {
      const body: Record<string, unknown> = { ...(payload ?? {}) };
      if (cursor) body.start_cursor = cursor;
      const res = this.queryDatabase(databaseId, body);
      results.push(...res.results);
      cursor = res.has_more ? res.next_cursor : null;
    } while (cursor);
    return results;
  },

  /** LINE等から取得したBlobをNotionへアップロードし、file_upload IDを返す */
  uploadFile(blob: GoogleAppsScript.Base.Blob, filename: string): string {
    // 1) アップロード枠の作成
    const created = notionFetch<{ id: string }>('post', '/file_uploads', {
      mode: 'single_part',
      filename,
    });
    // 2) バイナリ送信(multipart/form-data)。contentTypeを指定しないこと(指定するとmultipartにならない)
    const res = UrlFetchApp.fetch(`https://api.notion.com/v1/file_uploads/${created.id}/send`, {
      method: 'post',
      headers: {
        Authorization: `Bearer ${CONFIG.NOTION_TOKEN}`,
        'Notion-Version': NOTION_VERSION,
      },
      payload: { file: blob.setName(filename) },
      muteHttpExceptions: true,
    });
    const code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      logError('NotionClient.uploadFile', `${code} ${res.getContentText()}`);
      throw new Error(`Notion file upload failed: ${code}`);
    }
    return created.id;
  },
};
```

アップロードしたファイルをページのFilesプロパティに添付する形式(参照用。添付処理自体はInventoryService側):

```json
{ "properties": { "写真": { "files": [
  { "type": "file_upload", "name": "photo.jpg", "file_upload": { "id": "<fileUploadId>" } }
] } } }
```

## 4. 注意点

- single_part の上限は20MB。超えたら例外でよい(呼び出し側がユーザーに謝るメッセージを返す)。
- `/file_uploads` エンドポイントが `Notion-Version: 2022-06-28` で弾かれる場合は、**このリクエストに限り**ヘッダを新しい版(例: `2025-09-03`)へ上げる。先に実挙動を確認してから決めること(実装書15のセットアップ時に検証)。
- GASでは `payload` にBlobを含むオブジェクトを渡すと UrlFetchApp が自動で multipart/form-data にする。

## 5. 受け入れ基準

- [ ] 2xx以外で `logError` + 例外。429/5xxで1回リトライする。
- [ ] `NotionPage` / `NotionQueryResponse` / `NotionPropertyValue` がexportされている。
- [ ] `queryAll` が `has_more` / `next_cursor` を正しく辿り、引数payloadを破壊しない。
- [ ] `uploadFile` の `/send` リクエストで contentType を明示指定していない。
- [ ] トークンがログに出ない。`npm run typecheck` が通る。

## 6. 動作確認方法

スクリプトプロパティ設定+Notion DB作成後(実装書15):

```ts
export const test_notionQuery = (): void => {
  const pages = NotionClient.queryAll(CONFIG.NOTION_INVENTORY_DB_ID);
  logInfo('test', `pages=${pages.length}`);
};

export const test_notionUpload = (): void => {
  const blob = Utilities.newBlob('hello', 'text/plain', 'hello.txt');
  const id = NotionClient.uploadFile(blob, 'hello.txt');
  logInfo('test', `fileUploadId=${id}`);
};
```
