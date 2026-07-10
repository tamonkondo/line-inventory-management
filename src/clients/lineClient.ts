import { CONFIG } from '../config';
import { logError } from '../utils/logger';
import type { LineMessage } from '../types';

export interface LineProfile {
  displayName: string;
  userId: string;
  pictureUrl?: string;
  statusMessage?: string;
}

/**
 * 共通fetch。2xx以外はエラーログを出して例外を投げる(richMenuSetup等からも再利用する)。
 * retryOnce=true なら429/5xxを1回だけリトライする(replyはトークンが1回限りのため使わない)。
 */
export const lineFetch = <T>(
  method: 'get' | 'post' | 'delete',
  path: string,
  payload?: object,
  retryOnce = false,
): T | null => {
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method,
    headers: { Authorization: `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}` },
    muteHttpExceptions: true,
    ...(payload ? { contentType: 'application/json', payload: JSON.stringify(payload) } : {}),
  };
  const url = `https://api.line.me/v2/bot${path}`;
  let res = UrlFetchApp.fetch(url, options);
  let code = res.getResponseCode();
  if (retryOnce && (code === 429 || code >= 500)) {
    Utilities.sleep(1000);
    res = UrlFetchApp.fetch(url, options);
    code = res.getResponseCode();
  }
  if (code < 200 || code >= 300) {
    logError('LineClient', `${method} ${path} → ${code} ${res.getContentText()}`);
    throw new Error(`LINE API error: ${code}`);
  }
  const text = res.getContentText();
  return text ? (JSON.parse(text) as T) : null;
};

/** LINEのmulticastは1回の呼び出しで最大500 userId */
const MULTICAST_LIMIT = 500;

/** LINE Messaging API の薄いラッパー。業務ロジックは持たない。 */
export const LineClient = {
  /** 応答メッセージ。messages は最大5件。replyTokenは1回限りなのでリトライしない */
  reply(replyToken: string, messages: LineMessage[]): void {
    lineFetch('post', '/message/reply', { replyToken, messages });
  },

  /** 1ユーザーへのプッシュ(一時エラーは1回リトライ) */
  push(userId: string, messages: LineMessage[]): void {
    lineFetch('post', '/message/push', { to: userId, messages }, true);
  },

  /** 複数ユーザーへの一斉送信。500件ずつ分割して送る。空配列なら何もしない */
  multicast(userIds: string[], messages: LineMessage[]): void {
    for (let start = 0; start < userIds.length; start += MULTICAST_LIMIT) {
      const chunk = userIds.slice(start, start + MULTICAST_LIMIT);
      lineFetch('post', '/message/multicast', { to: chunk, messages }, true);
    }
  },

  /** プロフィール取得(一時エラーは1回リトライ) */
  getProfile(userId: string): LineProfile {
    const profile = lineFetch<LineProfile>('get', `/profile/${userId}`, undefined, true);
    if (!profile) throw new Error('LINE profile response was empty');
    return profile;
  },

  /** 画像等のコンテンツ取得 → Blob。※ホストが api-data.line.me な点に注意 */
  getMessageContent(messageId: string): GoogleAppsScript.Base.Blob {
    const res = UrlFetchApp.fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        method: 'get',
        headers: { Authorization: `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}` },
        muteHttpExceptions: true,
      },
    );
    if (res.getResponseCode() !== 200) {
      throw new Error(`LINE content fetch failed: ${res.getResponseCode()}`);
    }
    return res.getBlob();
  },
};
