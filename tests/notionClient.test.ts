import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installProperties, installUrlFetch, installUtilities, installCache, makeBlob } from './helpers/gasMocks';
import { NotionClient } from '../src/clients/notionClient';

const page = (id: string): string => JSON.stringify({ id, properties: {} });
const dbMeta = (dsId = 'ds-1'): string =>
  JSON.stringify({ id: 'db-1', data_sources: [{ id: dsId, name: 'main' }] });
const emptyQuery = JSON.stringify({ results: [], has_more: false, next_cursor: null });

describe('NotionClient', () => {
  beforeEach(() => {
    installProperties({ NOTION_TOKEN: 'ntn_test' });
    installUtilities();
    installCache();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('queryDatabaseがdata_source_idを解決してdata_sourcesエンドポイントへPOSTする', () => {
    const { calls } = installUrlFetch([
      { code: 200, body: dbMeta() },
      { code: 200, body: emptyQuery },
    ]);
    NotionClient.queryDatabase('db-1', { page_size: 1 });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://api.notion.com/v1/databases/db-1');
    expect(calls[0].options.method).toBe('get');
    expect(calls[1].url).toBe('https://api.notion.com/v1/data_sources/ds-1/query');
    const headers = calls[1].options.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ntn_test');
    expect(headers['Notion-Version']).toBe('2026-03-11');
  });

  it('data_source_idの解決結果はキャッシュされ2回目以降はGETしない', () => {
    const { calls } = installUrlFetch([
      { code: 200, body: dbMeta() },
      { code: 200, body: emptyQuery },
      { code: 200, body: emptyQuery },
    ]);
    NotionClient.queryDatabase('db-1', {});
    NotionClient.queryDatabase('db-1', {});
    expect(calls).toHaveLength(3); // GET 1回 + query 2回
    expect(calls[2].url).toBe('https://api.notion.com/v1/data_sources/ds-1/query');
  });

  it('データソースが無いDBは分かりやすいエラーになる', () => {
    installUrlFetch([{ code: 200, body: JSON.stringify({ id: 'db-1', data_sources: [] }) }]);
    expect(() => NotionClient.queryDatabase('db-1', {})).toThrow('no data sources');
  });

  it('createPageがparentのdatabase_idをdata_source_idへ自動変換する', () => {
    const { calls } = installUrlFetch([
      { code: 200, body: dbMeta() },
      { code: 200, body: page('p1') },
    ]);
    NotionClient.createPage({ parent: { database_id: 'db-1' }, properties: {} });
    const sent = JSON.parse(calls[1].options.payload as string) as { parent: unknown };
    expect(sent.parent).toEqual({ type: 'data_source_id', data_source_id: 'ds-1' });
  });

  it('429で1回リトライして成功する', () => {
    const { calls } = installUrlFetch([
      { code: 429, body: '{"message":"rate limited"}' },
      { code: 200, body: page('p1') },
    ]);
    const res = NotionClient.retrievePage('p1');
    expect(calls).toHaveLength(2);
    expect(res.id).toBe('p1');
  });

  it('リトライ後も失敗なら例外', () => {
    installUrlFetch([
      { code: 500, body: 'err' },
      { code: 500, body: 'err' },
    ]);
    expect(() => NotionClient.retrievePage('p1')).toThrow('Notion API error: 500');
  });

  it('非冪等なPOSTは5xxでリトライしない(二重書き込み防止)', () => {
    const { calls } = installUrlFetch([{ code: 502, body: 'gateway' }]);
    expect(() => NotionClient.createPage({ parent: {} })).toThrow('Notion API error: 502');
    expect(calls).toHaveLength(1);
  });

  it('POSTでも429はリトライする(未実行が保証されるため)', () => {
    const { calls } = installUrlFetch([
      { code: 429, body: 'rate limited' },
      { code: 200, body: page('p1') },
    ]);
    const res = NotionClient.createPage({ parent: {} });
    expect(calls).toHaveLength(2);
    expect(res.id).toBe('p1');
  });

  it('4xxはリトライせず即例外', () => {
    const { calls } = installUrlFetch([{ code: 404, body: 'nf' }]);
    expect(() => NotionClient.retrievePage('p1')).toThrow('Notion API error: 404');
    expect(calls).toHaveLength(1);
  });

  it('queryAllがpaginationを辿り、引数payloadを破壊しない', () => {
    const { calls } = installUrlFetch([
      { code: 200, body: dbMeta() },
      { code: 200, body: JSON.stringify({ results: [{ id: 'a', properties: {} }], has_more: true, next_cursor: 'cur-1' }) },
      { code: 200, body: JSON.stringify({ results: [{ id: 'b', properties: {} }], has_more: false, next_cursor: null }) },
    ]);
    const payload = { sorts: [] };
    const pages = NotionClient.queryAll('db-1', payload);
    expect(pages.map((p) => p.id)).toEqual(['a', 'b']);
    expect(JSON.parse(calls[2].options.payload as string).start_cursor).toBe('cur-1');
    expect('start_cursor' in payload).toBe(false);
  });

  it('uploadFileが枠作成→multipart送信しIDを返す(contentType未指定)', () => {
    const { calls } = installUrlFetch([
      { code: 200, body: '{"id":"fu-1","upload_url":"..."}' },
      { code: 200, body: '{"id":"fu-1","status":"uploaded"}' },
    ]);
    const blob = makeBlob('img-bytes', 'image/jpeg') as unknown as GoogleAppsScript.Base.Blob;
    const id = NotionClient.uploadFile(blob, 'photo.jpg');
    expect(id).toBe('fu-1');
    expect(calls[0].url).toBe('https://api.notion.com/v1/file_uploads');
    expect(calls[1].url).toBe('https://api.notion.com/v1/file_uploads/fu-1/send');
    expect(calls[1].options.contentType).toBeUndefined();
    const sent = calls[1].options.payload as { file: { getName: () => string } };
    expect(sent.file.getName()).toBe('photo.jpg');
  });

  it('uploadFileの送信失敗で例外', () => {
    installUrlFetch([
      { code: 200, body: '{"id":"fu-1"}' },
      { code: 400, body: 'bad' },
    ]);
    const blob = makeBlob('x') as unknown as GoogleAppsScript.Base.Blob;
    expect(() => NotionClient.uploadFile(blob, 'a.jpg')).toThrow('Notion file upload failed: 400');
  });
});
