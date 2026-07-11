import { LineClient } from '../clients/lineClient';
import { InventoryService } from '../services/inventoryService';
import { PurchaseService } from '../services/purchaseService';
import { FlexBuilder, textMessage } from '../messages/flexBuilder';
import { SessionStore } from '../utils/sessionStore';
import { routeCommand, executeOut, executeBuy, buildHistoryMessages, promptStoresStep, finishNewItem } from '../router/commandRouter';
import { logError } from '../utils/logger';
import type { CommandContext, LineMessage, LineWebhookEvent } from '../types';

const RETRY_MESSAGE = '操作をやり直してください。';
const NEW_FLOW_EXPIRED = '操作の有効期限が切れました。「新規登録」からやり直してください。';

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

/** 新規登録フローの選択ステップ(R-13)。セッション失効時は不整合な品目を作らず再開を促す */
const handleNewItemStep = (
  step: 'category' | 'store' | 'storesDone',
  value: string,
  context: CommandContext,
): LineMessage[] => {
  const session = SessionStore.get(context.lineUserId);

  if (step === 'category') {
    if (session?.flow !== 'new' || session.step !== 'category') return [textMessage(NEW_FLOW_EXPIRED)];
    return promptStoresStep({ name: session.data.name, category: value || null, stores: [] }, context);
  }

  if (session?.flow !== 'new' || session.step !== 'stores') return [textMessage(NEW_FLOW_EXPIRED)];

  if (step === 'store') {
    if (!value) return promptStoresStep(session.data, context);
    const stores = session.data.stores.includes(value)
      ? session.data.stores.filter((store) => store !== value)
      : [...session.data.stores, value];
    return promptStoresStep({ ...session.data, stores }, context); // 選択状態を更新して再提示
  }

  // storesDone
  return finishNewItem(session.data, context);
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
      if (step === 'category' || step === 'store' || step === 'storesDone') {
        return handleNewItemStep(step, data.value ?? '', context);
      }
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
      if (!id) break;
      if (step === 'menu') {
        const item = InventoryService.getByPageId(id);
        return item ? [FlexBuilder.buildEditMenuMessage(item)] : [textMessage(RETRY_MESSAGE)];
      }
      if (step === 'field') {
        const field = data.field;
        if (field === 'name') {
          SessionStore.set(context.lineUserId, { flow: 'edit', step: 'name', data: { pageId: id } });
          return [textMessage('新しい名前を送ってください(やめる場合は「キャンセル」)。')];
        }
        if (field === 'stores') {
          SessionStore.set(context.lineUserId, { flow: 'edit', step: 'stores', data: { pageId: id } });
          return [textMessage('購入先を「スーパー / Amazon」のように送ってください(全置換。やめる場合は「キャンセル」)。')];
        }
        if (field === 'photo') {
          SessionStore.set(context.lineUserId, { flow: 'attach_photo', step: 'wait', data: { pageId: id } });
          return [textMessage('写真を送ってください(やめる場合は「キャンセル」)。')];
        }
      }
      break;
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

  const data = parsePostbackData(event.postback.data);

  // ボタンのタップは基本「新しい操作の開始」: 途中のステップ入力が残っていると
  // 次のテキストを誤って食ってしまうため破棄してから処理する。
  // ただし新規登録フローの選択ステップ(R-13)はセッション継続が前提のため破棄しない。
  const continuesSession =
    data.action === 'new' && (data.step === 'category' || data.step === 'store' || data.step === 'storesDone');
  if (!continuesSession) SessionStore.clear(userId);

  const messages = executePostback(data, { lineUserId: userId });
  if (messages.length > 0) LineClient.reply(event.replyToken, messages);
};
