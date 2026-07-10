import { LineClient } from '../clients/lineClient';
import { InventoryService } from '../services/inventoryService';
import { PurchaseService } from '../services/purchaseService';
import { FlexBuilder } from '../messages/flexBuilder';
import { SessionStore } from '../utils/sessionStore';
import { routeCommand, executeOut, executeBuy } from '../router/commandRouter';
import { logError } from '../utils/logger';
import type { CommandContext, LineMessage, LineWebhookEvent } from '../types';

const text = (body: string): LineMessage => ({ type: 'text', text: body });

const RETRY_MESSAGE = '操作をやり直してください。';

/** `action=out&step=pick&id=xxx` 形式のクエリ文字列を分解する */
const parsePostbackData = (data: string): Record<string, string> => {
  const entries = data.split('&').map((pair) => {
    const [key, value = ''] = pair.split('=');
    return [decodeURIComponent(key), decodeURIComponent(value)] as const;
  });
  const result: Record<string, string> = {};
  for (const [key, value] of entries) result[key] = value;
  return result;
};

/** pageIdから品目を引く。見つからなければnull(呼び出し側が案内を返す) */
const findItem = (pageId: string) => {
  try {
    return InventoryService.getByPageId(pageId);
  } catch (err) {
    logError('postbackHandler.findItem', err);
    return null;
  }
};

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
        const item = findItem(id);
        return item ? executeOut(item, context) : [text(RETRY_MESSAGE)];
      }
      break;
    }
    case 'buy': {
      if (step === 'start') return routeCommand('買った', context) ?? [];
      if (step === 'pick' && id) {
        const item = findItem(id);
        return item ? executeBuy(item, context) : [text(RETRY_MESSAGE)];
      }
      break;
    }
    case 'new': {
      if (step === 'start') return routeCommand('新規', context) ?? [];
      break;
    }
    case 'detail': {
      if (!id) break;
      const item = findItem(id);
      if (!item) return [text(RETRY_MESSAGE)];
      return [FlexBuilder.buildItemCard(item, PurchaseService.listRecent(item.pageId, 3))];
    }
    case 'history': {
      if (!id) break;
      const item = findItem(id);
      if (!item) return [text(RETRY_MESSAGE)];
      const purchases = PurchaseService.listRecent(item.pageId, 5);
      if (purchases.length === 0) return [text(`${item.name} の購入履歴はまだありません。`)];
      const lines = purchases.map((purchase) => `・${purchase.purchasedAt ?? '(日付不明)'}`).join('\n');
      return [text(`${item.name} の購入履歴\n${lines}`)];
    }
    case 'edit': {
      if (!id) break;
      if (step === 'menu') {
        const item = findItem(id);
        return item ? [FlexBuilder.buildEditMenuMessage(item)] : [text(RETRY_MESSAGE)];
      }
      if (step === 'field') {
        const field = data.field;
        if (field === 'name') {
          SessionStore.set(context.lineUserId, { flow: 'edit', step: 'name', data: { pageId: id } });
          return [text('新しい名前を送ってください(やめる場合は「キャンセル」)。')];
        }
        if (field === 'stores') {
          SessionStore.set(context.lineUserId, { flow: 'edit', step: 'stores', data: { pageId: id } });
          return [text('購入先を「スーパー / Amazon」のように送ってください(全置換。やめる場合は「キャンセル」)。')];
        }
        if (field === 'photo') {
          SessionStore.set(context.lineUserId, { flow: 'attach_photo', step: 'wait', data: { pageId: id } });
          return [text('写真を送ってください(やめる場合は「キャンセル」)。')];
        }
      }
      break;
    }
    case 'cancel':
      SessionStore.clear(context.lineUserId);
      return [text('キャンセルしました。')];
    default:
      break;
  }

  logError('postbackHandler', `unknown postback: ${JSON.stringify(data)}`);
  return [text(RETRY_MESSAGE)];
};

/** リッチメニューやボタンからの postback イベントを処理する。 */
export const handlePostback = (event: LineWebhookEvent): void => {
  const userId = event.source.userId;
  if (!userId || !event.replyToken || !event.postback) return;
  const data = parsePostbackData(event.postback.data);
  const messages = executePostback(data, { lineUserId: userId });
  if (messages.length > 0) LineClient.reply(event.replyToken, messages);
};
