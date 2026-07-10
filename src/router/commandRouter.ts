import { InventoryService } from '../services/inventoryService';
import { PurchaseService } from '../services/purchaseService';
import { NotificationService } from '../services/notificationService';
import { UserService } from '../services/userService';
import { FlexBuilder } from '../messages/flexBuilder';
import { SessionStore } from '../utils/sessionStore';
import { parseCommand } from '../utils/parse';
import type { CommandContext, InventoryItem, LineMessage } from '../types';

const text = (body: string): LineMessage => ({ type: 'text', text: body });

const isDuplicateError = (err: unknown): boolean =>
  err instanceof Error && err.message === 'DUPLICATE_ITEM';

type ResolveResult =
  | { kind: 'found'; item: InventoryItem }
  | { kind: 'candidates'; items: InventoryItem[] }
  | { kind: 'notFound' };

/** 品名から品目を解決する(完全一致 → 部分一致1件 → 候補提示/なし) */
const resolveItem = (arg: string): ResolveResult => {
  const exact = InventoryService.findByName(arg);
  if (exact) return { kind: 'found', item: exact };
  const partial = InventoryService.search(arg);
  if (partial.length === 1) return { kind: 'found', item: partial[0] };
  if (partial.length > 1) return { kind: 'candidates', items: partial };
  return { kind: 'notFound' };
};

/** 「なくなった」の実処理(postbackHandlerと共用)。すでに在庫切れなら通知しない */
export const executeOut = (item: InventoryItem, context: CommandContext): LineMessage[] => {
  if (!item.inStock) {
    return [text(`${item.name} はすでに在庫切れです。`)];
  }
  InventoryService.setInStock(item.pageId, false);
  NotificationService.notifyOutOfStock({ ...item, inStock: false }, context.lineUserId);
  return [text(`${item.name} を在庫切れにしました。みんなに知らせておきます 📢`)];
};

/** 「買った」の実処理(postbackHandlerと共用)。在庫ありのままでも購入は記録する */
export const executeBuy = (item: InventoryItem, context: CommandContext): LineMessage[] => {
  const wasInStock = item.inStock;
  InventoryService.setInStock(item.pageId, true);
  const userPageId = UserService.findByLineUserId(context.lineUserId)?.pageId ?? null;
  PurchaseService.record(item, userPageId);
  return [
    text(wasInStock
      ? `${item.name} の購入を記録しました(在庫ありのままです)。`
      : `${item.name} を在庫ありにして、購入履歴に記録しました ✅`),
  ];
};

/** 品目解決に失敗したときの共通メッセージ(候補があれば選択リストを付ける) */
const unresolvedMessages = (arg: string, result: ResolveResult, pickAction?: 'out' | 'buy'): LineMessage[] => {
  if (result.kind === 'candidates') {
    if (pickAction) {
      return [text(`「${arg}」に該当する品目が複数あります。選んでください。`),
        FlexBuilder.buildPickListMessage(result.items, pickAction)];
    }
    const names = result.items.map((item) => `・${item.name}`).join('\n');
    return [text(`「${arg}」に該当する品目が複数あります。正確な品名で送ってください。\n${names}`)];
  }
  return [text(`「${arg}」が見つかりません。「在庫」で一覧を確認できます。`)];
};

const handleOut = (arg: string, context: CommandContext): LineMessage[] => {
  if (arg) {
    const result = resolveItem(arg);
    if (result.kind === 'found') return executeOut(result.item, context);
    return unresolvedMessages(arg, result, 'out');
  }
  const inStockItems = InventoryService.list().filter((item) => item.inStock);
  if (inStockItems.length === 0) return [text('在庫ありの品目がありません。')];
  return [FlexBuilder.buildPickListMessage(inStockItems, 'out')];
};

const handleBuy = (arg: string, context: CommandContext): LineMessage[] => {
  if (arg) {
    const result = resolveItem(arg);
    if (result.kind === 'found') return executeBuy(result.item, context);
    return unresolvedMessages(arg, result, 'buy');
  }
  const shortage = InventoryService.listShortage();
  const pickTargets = shortage.length > 0 ? shortage : InventoryService.list();
  if (pickTargets.length === 0) return [text('品目が登録されていません。「新規 品名」で登録できます。')];
  return [FlexBuilder.buildPickListMessage(pickTargets, 'buy')];
};

const handleNew = (arg: string, context: CommandContext): LineMessage[] => {
  if (!arg) {
    SessionStore.set(context.lineUserId, { flow: 'new', step: 'name' });
    return [text('登録する品名を送ってください(やめる場合は「キャンセル」)。')];
  }
  try {
    const item = InventoryService.create({ name: arg });
    SessionStore.set(context.lineUserId, { flow: 'attach_photo', step: 'wait', data: { pageId: item.pageId } });
    return [
      text(`「${item.name}」を登録しました。`),
      FlexBuilder.buildItemCard(item),
      text('続けて写真を送ると登録できます(不要なら「キャンセル」)。'),
    ];
  } catch (err) {
    if (isDuplicateError(err)) return [text(`「${arg}」はすでに登録されています。`)];
    throw err;
  }
};

const handleHistory = (arg: string): LineMessage[] => {
  if (!arg) return [text('「履歴 品名」の形で送ってください。')];
  const result = resolveItem(arg);
  if (result.kind !== 'found') return unresolvedMessages(arg, result);
  const purchases = PurchaseService.listRecent(result.item.pageId, 5);
  if (purchases.length === 0) return [text(`${result.item.name} の購入履歴はまだありません。`)];
  const lines = purchases.map((purchase) => `・${purchase.purchasedAt ?? '(日付不明)'}`).join('\n');
  return [text(`${result.item.name} の購入履歴\n${lines}`)];
};

const handleEdit = (arg: string): LineMessage[] => {
  if (!arg) return [text('「編集 品名」の形で送ってください。')];
  const result = resolveItem(arg);
  if (result.kind !== 'found') return unresolvedMessages(arg, result);
  return [FlexBuilder.buildEditMenuMessage(result.item)];
};

/**
 * コマンドを解釈してサービスを呼び、返信メッセージ配列を返す。
 * コマンドでなければ null(呼び出し側がフォールバック)。
 * 返信自体はしない(reply は messageHandler の責務)。
 */
export const routeCommand = (input: string, context: CommandContext): LineMessage[] | null => {
  const parsed = parseCommand(input);
  if (!parsed) return null;

  switch (parsed.command) {
    case 'list': {
      const items = InventoryService.list();
      if (items.length === 0) return [text('まだ品目が登録されていません。「新規 品名」で登録できます。')];
      return [FlexBuilder.buildItemListMessage('在庫一覧', items)];
    }
    case 'shortage': {
      const items = InventoryService.listShortage();
      if (items.length === 0) return [text('不足はありません 🎉')];
      return [FlexBuilder.buildItemListMessage('不足一覧', items)];
    }
    case 'out':
      return handleOut(parsed.arg, context);
    case 'buy':
      return handleBuy(parsed.arg, context);
    case 'new':
      return handleNew(parsed.arg, context);
    case 'history':
      return handleHistory(parsed.arg);
    case 'search': {
      if (!parsed.arg) return [text('「検索 キーワード」の形で送ってください。')];
      const items = InventoryService.search(parsed.arg);
      if (items.length === 0) return [text(`「${parsed.arg}」は見つかりませんでした。`)];
      return [FlexBuilder.buildItemListMessage(`検索: ${parsed.arg}`, items)];
    }
    case 'edit':
      return handleEdit(parsed.arg);
    case 'help':
      return [FlexBuilder.buildHelpMessage()];
  }
};
