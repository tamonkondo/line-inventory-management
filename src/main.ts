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
