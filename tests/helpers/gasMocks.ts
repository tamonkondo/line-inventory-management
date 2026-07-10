/**
 * テスト用のGASグローバルモック。
 * 各テストで必要なものだけ installXxx() を呼んで globalThis に生やす。
 */

type AnyRecord = Record<string, unknown>;

const g = globalThis as AnyRecord;

/** PropertiesService.getScriptProperties().getProperty のモック */
export const installProperties = (props: Record<string, string>): void => {
  g.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key: string) => props[key] ?? null,
    }),
  };
};

/** CacheService(スクリプトキャッシュ)のインメモリ実装 */
export const installCache = (): Map<string, string> => {
  const store = new Map<string, string>();
  g.CacheService = {
    getScriptCache: () => ({
      get: (key: string) => store.get(key) ?? null,
      put: (key: string, value: string, _ttl?: number) => { store.set(key, value); },
      remove: (key: string) => { store.delete(key); },
    }),
  };
  return store;
};

/** Utilities のモック(formatDateは固定日付、sleepはno-op) */
export const installUtilities = (fixedDate = '2026-07-10'): void => {
  g.Utilities = {
    formatDate: (_d: Date, _tz: string, format: string) =>
      format.includes('HH') ? `${fixedDate.replace(/-/g, '')}-120000` : fixedDate,
    sleep: (_ms: number) => undefined,
    newBlob: (data: string, contentType?: string, name?: string) => makeBlob(data, contentType, name),
    computeHmacSha256Signature: (_value: number[], _key: number[]) => [1, 2, 3],
    base64Encode: (_bytes: number[]) => 'base64-mock',
  };
};

export interface MockBlob {
  getContentType: () => string | null;
  getBytes: () => number[];
  getName: () => string | null;
  setName: (name: string) => MockBlob;
}

export const makeBlob = (data: string, contentType?: string, name?: string): MockBlob => {
  let blobName = name ?? null;
  const blob: MockBlob = {
    getContentType: () => contentType ?? null,
    getBytes: () => Array.from(data, (c) => c.charCodeAt(0)),
    getName: () => blobName,
    setName: (n: string) => { blobName = n; return blob; },
  };
  return blob;
};

/** ContentService のモック(createTextOutputの内容を取り出せる) */
export const installContentService = (): void => {
  g.ContentService = {
    createTextOutput: (text: string) => ({ getContent: () => text }),
  };
};

export interface FetchCall {
  url: string;
  options: AnyRecord;
}

export interface MockResponse {
  code: number;
  body: string;
  blob?: MockBlob;
}

/**
 * UrlFetchApp のモック。呼び出し履歴と、応答キュー(先頭から消費。空なら200 {})を持つ。
 */
export const installUrlFetch = (responses: MockResponse[] = []): { calls: FetchCall[]; queue: MockResponse[] } => {
  const calls: FetchCall[] = [];
  const queue = [...responses];
  g.UrlFetchApp = {
    fetch: (url: string, options: AnyRecord = {}) => {
      calls.push({ url, options });
      const res = queue.length > 0 ? queue.shift()! : { code: 200, body: '{}' };
      return {
        getResponseCode: () => res.code,
        getContentText: () => res.body,
        getBlob: () => res.blob ?? makeBlob(res.body),
      };
    },
  };
  return { calls, queue };
};
