import { CONFIG } from '../config';
import { logError } from '../utils/logger';
import type { LineMessage } from '../types';

export interface LineProfile {
  displayName: string;
  userId: string;
  pictureUrl?: string;
  statusMessage?: string;
}

/** 共通fetch。2xx以外はエラーログを出して例外を投げる(richMenuSetup等からも再利用する) */
export const lineFetch = <T>(method: 'get' | 'post' | 'delete', path: string, payload?: object): T | null => {
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method,
    headers: { Authorization: `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}` },
    muteHttpExceptions: true,
    ...(payload ? { contentType: 'application/json', payload: JSON.stringify(payload) } : {}),
  };
  const res = UrlFetchApp.fetch(`https://api.line.me/v2/bot${path}`, options);
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    logError('LineClient', `${method} ${path} → ${code} ${res.getContentText()}`);
    throw new Error(`LINE API error: ${code}`);
  }
  const text = res.getContentText();
  return text ? (JSON.parse(text) as T) : null;
};

/** LINE Messaging API の薄いラッパー。業務ロジックは持たない。 */
export const LineClient = {
  /** 応答メッセージ。messages は最大5件。replyTokenは1回限りなのでリトライしない */
  reply(replyToken: string, messages: LineMessage[]): void {
    lineFetch('post', '/message/reply', { replyToken, messages });
  },

  /** 1ユーザーへのプッシュ */
  push(userId: string, messages: LineMessage[]): void {
    lineFetch('post', '/message/push', { to: userId, messages });
  },

  /** 複数ユーザーへの一斉送信(最大500 userId)。空配列なら何もしない */
  multicast(userIds: string[], messages: LineMessage[]): void {
    if (userIds.length === 0) return;
    lineFetch('post', '/message/multicast', { to: userIds, messages });
  },

  /** プロフィール取得 */
  getProfile(userId: string): LineProfile {
    const profile = lineFetch<LineProfile>('get', `/profile/${userId}`);
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
