# 実装書(03): LINE Messaging API クライアント

- **依存**: 01
- **対象ファイル**: `src/clients/lineClient.ts`(新規)。旧 `src/clients/lineClient.js` を削除

## 目的

LINE Messaging API の薄いラッパーを実装する。業務ロジックは持たない。

## 1. 実装内容

ベースURL: `https://api.line.me/v2/bot`
認証ヘッダ: `Authorization: Bearer <CONFIG.LINE_CHANNEL_ACCESS_TOKEN>`

```ts
import { CONFIG } from '../config';
import { logError } from '../utils/logger';
import type { LineMessage } from '../types';

interface LineProfile {
  displayName: string;
  userId: string;
  pictureUrl?: string;
  statusMessage?: string;
}

/** 共通fetch。2xx以外はエラーログを出して例外を投げる */
const lineFetch = <T>(method: 'get' | 'post', path: string, payload?: object): T | null => {
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

/** LINE Messaging API の薄いラッパー。 */
export const LineClient = {
  /** 応答メッセージ。messages は最大5件 */
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
```

## 2. 注意点

- `reply` の messages は**配列**で受ける(呼び出し側が単一メッセージでも `[msg]` で渡す)。
- replyTokenは1回しか使えない。リトライ実装は入れない(失敗したらログのみ)。
- `getMessageContent` のホストは `api-data.line.me`(通常APIと異なる)。
- リッチメニュー系APIは実装書14の `richMenuSetup.ts` 側に置く(このファイルには追加しない)。`lineFetch` はそこからも使うため **export する**(`export const lineFetch = ...` に変更してよい)。

## 3. 受け入れ基準

- [ ] 上記5メソッドが実装されている。
- [ ] 2xx以外のレスポンスで `logError` が呼ばれ、例外が投がる。
- [ ] トークンがログに出力されない。
- [ ] `multicast([], msgs)` が API を呼ばない。
- [ ] `npm run typecheck` が通る(`any` を使っていない)。

## 4. 動作確認方法

スクリプトプロパティ `LINE_CHANNEL_ACCESS_TOKEN` 設定後:

```ts
export const test_linePush = (): void => {
  // 自分のuserId(Webhookのログ等で確認)に対して送る
  LineClient.push('U自分のuserId', [{ type: 'text', text: 'テスト送信' }]);
};
```

LINEに「テスト送信」が届けばOK。`getProfile` も同じuserIdで表示名が取れることを確認。
