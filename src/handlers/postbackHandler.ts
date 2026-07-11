import { LineClient } from '../clients/lineClient';
import { InventoryService } from '../services/inventoryService';
import { PurchaseService } from '../services/purchaseService';
import { FlexBuilder, textMessage } from '../messages/flexBuilder';
import { SessionStore } from '../utils/sessionStore';
import { routeCommand, executeOut, executeBuy, buildHistoryMessages, buildEditLinkMessages } from '../router/commandRouter';
import { logError } from '../utils/logger';
import type { CommandContext, LineMessage, LineWebhookEvent } from '../types';

const RETRY_MESSAGE = '操作をやり直してください。';

/** 不正な%シーケンスを含む値でイベント全体を落とさないためのデコード */
const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** `action=out&step=pick&id=xxx` 形式のクエリ文字列を分解する */
const parsePostbackData = (data: string): Record<string, string> =>
  Object.fromEntries(
    data.split('&').map((pair) => {
      const [key, value = ''] = pair.split('=');
      return [safeDecode(key), safeDecode(value)];
    }),
  );

const executePostback = (data: Record<string, string>, context: CommandContext): LineMessage[] => {
  const { action, step, id } = data;

  switch (action) {
    // リッチメニューの各ボタンは同名コマンドと同一挙動(routeCommandを再利用)
    case 'list':
      return routeCommand('在庫', context) ?? [];
    case 'shortage':
      return routeCommand('不足', context) ?? [];
    case 'help':
      return routeCommand('ヘルプ', context) ?? [];

    case 'out': {
      if (step === 'start') return routeCommand('なくなった', context) ?? [];
      if (step === 'pick' && id) {
        const item = InventoryService.getByPageId(id);
        return item ? executeOut(item, context) : [textMessage(RETRY_MESSAGE)];
      }
      break;
    }
    case 'buy': {
      if (step === 'start') return routeCommand('買った', context) ?? [];
      if (step === 'pick' && id) {
        const item = InventoryService.getByPageId(id);
        return item ? executeBuy(item, context) : [textMessage(RETRY_MESSAGE)];
      }
      break;
    }
    case 'new': {
      if (step === 'start') return routeCommand('新規', context) ?? [];
      break;
    }
    case 'detail': {
      if (!id) break;
      const item = InventoryService.getByPageId(id);
      if (!item) return [textMessage(RETRY_MESSAGE)];
      return [FlexBuilder.buildItemCard(item, PurchaseService.listRecent(item.pageId, 3))];
    }
    case 'history': {
      if (!id) break;
      const item = InventoryService.getByPageId(id);
      return item ? buildHistoryMessages(item) : [textMessage(RETRY_MESSAGE)];
    }
    case 'edit': {
      // 現行カードの「編集」はNotionへの直リンク(R-14)だが、
      // トーク履歴に残る旧カードのpostbackにはNotionのURL案内で応える(後方互換)
      if (!id) break;
      const item = InventoryService.getByPageId(id);
      return item ? buildEditLinkMessages(item) : [textMessage(RETRY_MESSAGE)];
    }
    case 'cancel':
      return [textMessage('キャンセルしました。')];
    default:
      break;
  }

  logError('postbackHandler', `unknown postback: ${JSON.stringify(data)}`);
  return [textMessage(RETRY_MESSAGE)];
};

/** リッチメニューやボタンからの postback イベントを処理する。 */
export const handlePostback = (event: LineWebhookEvent): void => {
  const userId = event.source.userId;
  if (!userId || !event.replyToken || !event.postback) return;

  // ボタンのタップは新しい操作の開始: 途中のステップ入力(新規登録の品名待ち等)が
  // 残っていると次のテキストを誤って食ってしまうため、必ず破棄してから処理する。
  // 各アクションが必要なセッションはこの後で自分でセットし直す。
  SessionStore.clear(userId);

  const data = parsePostbackData(event.postback.data);
  const messages = executePostback(data, { lineUserId: userId });
  if (messages.length > 0) LineClient.reply(event.replyToken, messages);
};
