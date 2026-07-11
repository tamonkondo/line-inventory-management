import { CONFIG } from '../config';
import { logError } from '../utils/logger';

/**
 * Notion APIバージョン。2025-09-03以降、データベースは複数データソースの
 * コンテナになり、クエリ・ページ作成はdata_source_id基準に変わった。
 * 本プロジェクトの設定値(NOTION_*_DB_ID)には**データソースID**を設定する。
 * https://developers.notion.com/reference/changes-by-version
 */
const NOTION_VERSION = '2026-03-11';

export interface NotionPage {
  id: string;
  url?: string; // NotionページのURL(編集画面への誘導に使う)
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
  // 429(未実行が保証される)は常に、5xxは冪等なGETのみ1回リトライ。
  // POST/PATCHの5xxはサーバー側でコミット済みの可能性があり、再送すると二重書き込みになる
  if (code === 429 || (code >= 500 && method === 'get')) {
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

/** Notion API の汎用ラッパー(スキーマに依存しない)。IDはすべてデータソースID基準 */
export const NotionClient = {
  /** データソースへのクエリ。POST /v1/data_sources/{id}/query */
  queryDataSource(dataSourceId: string, payload: object): NotionQueryResponse {
    return notionFetch<NotionQueryResponse>('post', `/data_sources/${dataSourceId}/query`, payload);
  },

  /** ページ作成。parentは { type: 'data_source_id', data_source_id } 形式で渡すこと */
  createPage(payload: object): NotionPage {
    return notionFetch<NotionPage>('post', '/pages', payload);
  },

  updatePage(pageId: string, payload: object): NotionPage {
    return notionFetch<NotionPage>('patch', `/pages/${pageId}`, payload);
  },

  retrievePage(pageId: string): NotionPage {
    return notionFetch<NotionPage>('get', `/pages/${pageId}`);
  },

  /** queryDataSourceのpaginationを吸収して全ページ配列を返す(引数payloadは破壊しない) */
  queryAll(dataSourceId: string, payload?: object): NotionPage[] {
    const results: NotionPage[] = [];
    let cursor: string | null = null;
    do {
      const body: Record<string, unknown> = { ...(payload ?? {}) };
      if (cursor) body.start_cursor = cursor;
      const res = this.queryDataSource(dataSourceId, body);
      results.push(...res.results);
      cursor = res.has_more ? res.next_cursor : null;
    } while (cursor);
    return results;
  },

  /**
   * LINE等から取得したBlobをNotionへアップロードし、file_upload IDを返す。
   * single_part の上限は20MB。
   */
  uploadFile(blob: GoogleAppsScript.Base.Blob, filename: string): string {
    // 1) アップロード枠の作成
    const created = notionFetch<{ id: string }>('post', '/file_uploads', {
      mode: 'single_part',
      filename,
    });
    // 2) バイナリ送信。payloadにBlobを含めるとUrlFetchAppが自動でmultipart/form-dataにする。
    //    contentTypeを指定しないこと(指定するとmultipartにならない)
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
