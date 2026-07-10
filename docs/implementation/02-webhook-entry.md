# 実装書(02): Webhookエントリ — 署名検証・main.ts

- **依存**: 01
- **対象ファイル**: `src/utils/signature.ts`(新規)、`src/main.ts`(01のプレースホルダを置き換え)。旧 `src/utils/signature.js`・`src/main.js` を削除

## 目的

LINEからのWebhookリクエストを受け、構造検証のうえイベントをハンドラへ振り分ける。

## 1. `src/utils/signature.ts`

LINEの署名検証仕様: リクエストボディ(生文字列)をチャネルシークレットでHMAC-SHA256署名し、Base64エンコードした値が `X-Line-Signature` ヘッダと一致すること。

> **重要な制約**: GASの `doPost(e)` ではHTTPリクエストヘッダを読めないため、X-Line-Signature の完全な検証は**不可能**。
> 代替として (1) Webhook URLの秘匿(推測不能なGASデプロイURL) (2) ボディ構造の妥当性検証 の2段構えとする。
> この制約と代替策をコードコメントに明記すること(将来Cloud Functions等へ移行する場合はHMAC検証を復活させる)。

```ts
import { CONFIG } from '../config';

/**
 * LINE Webhookリクエストの妥当性を検証する。
 * GASではX-Line-Signatureヘッダを取得できないため、構造検証+URL秘匿で代替する。
 */
export const verifySignature = (e: GoogleAppsScript.Events.DoPost | undefined): boolean => {
  if (!e?.postData?.contents) return false;
  try {
    const body: unknown = JSON.parse(e.postData.contents);
    return typeof body === 'object' && body !== null && Array.isArray((body as { events?: unknown }).events);
  } catch {
    return false;
  }
};

/** 参考実装: bodyのHMAC-SHA256をBase64で返す(ヘッダが取れる環境への移行用) */
export const computeLineSignature = (bodyText: string): string => {
  const raw = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(bodyText).getBytes(),
    Utilities.newBlob(CONFIG.LINE_CHANNEL_SECRET).getBytes(),
  );
  return Utilities.base64Encode(raw);
};
```

## 2. `src/main.ts`

```ts
import { verifySignature } from './utils/signature';
import { logInfo, logError } from './utils/logger';
import { handleMessage } from './handlers/messageHandler';
import { handlePostback } from './handlers/postbackHandler';
import { handleFollow, handleUnfollow } from './handlers/followHandler';
import type { LineWebhookEvent } from './types';

/** LINE Webhook 受信エントリポイント */
export const doPost = (e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput => {
  try {
    if (!verifySignature(e)) {
      return ContentService.createTextOutput('invalid signature');
    }
    const body = JSON.parse(e.postData.contents) as { events?: LineWebhookEvent[] };
    const events = body.events ?? [];
    logInfo('doPost', `events=${events.length}`); // 本文全体はログに出さない(プライバシー・ログ肥大防止)

    for (const event of events) {
      // 1イベントの失敗が他イベントの処理を止めないよう個別にcatch
      try {
        switch (event.type) {
          case 'message':  handleMessage(event);  break;
          case 'postback': handlePostback(event); break;
          case 'follow':   handleFollow(event);   break;
          case 'unfollow': handleUnfollow(event); break;
          default: break;
        }
      } catch (err) {
        logError(`doPost:event:${event.type}`, err);
      }
    }
    return ContentService.createTextOutput('OK');
  } catch (err) {
    logError('doPost', err);
    return ContentService.createTextOutput('error');
  }
};

/** 動作確認用(ブラウザアクセス) */
export const doGet = (): GoogleAppsScript.Content.TextOutput =>
  ContentService.createTextOutput('LINE Inventory Bot is running.');
```

- ハンドラ未実装の間はビルドを通すため、該当importを一時的にスタブ(空関数のexport)にしてよい。各ハンドラのタスクで置き換える。
- `global` への束縛は `src/index.ts`(実装書01)が担う。main.tsでは行わない。

## 3. 受け入れ基準

- [ ] `verifySignature` が「postDataなし」「JSONでない」「eventsが配列でない」入力で `false` を返す。
- [ ] 正常なWebhookボディ(`{"destination":"xxx","events":[]}`)で `true` を返す。
- [ ] `computeLineSignature` がexportされている(未使用でよい)。
- [ ] 1イベントの例外が他のイベント処理を止めない。
- [ ] GASの制約(ヘッダ取得不可)がコメントで説明されている。
- [ ] `npm run typecheck` / `npm run build` が通る。

## 4. 動作確認方法

```ts
export const test_signature = (): void => {
  const ok = verifySignature({ postData: { contents: '{"events":[]}' } } as GoogleAppsScript.Events.DoPost);
  const ng = verifySignature(undefined);
  logInfo('test', { ok, ng }); // → {ok:true, ng:false}
};
```

デプロイ後、`curl -X POST <WebアプリURL> -H 'Content-Type: application/json' -d '{"events":[]}'` が `OK` を返すこと。
