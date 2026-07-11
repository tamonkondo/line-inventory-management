import { InventoryService, isDuplicateItemError } from '../services/inventoryService';
import { PurchaseService } from '../services/purchaseService';
import { NotificationService } from '../services/notificationService';
import { UserService } from '../services/userService';
import { FlexBuilder, textMessage } from '../messages/flexBuilder';
import { SessionStore } from '../utils/sessionStore';
import { parseCommand } from '../utils/parse';
import { logInfo, logError } from '../utils/logger';
import type { CommandContext, InventoryItem, LineMessage } from '../types';

type ResolveResult =
  | { kind: 'found'; item: InventoryItem }
  | { kind: 'candidates'; items: InventoryItem[] }
  | { kind: 'notFound' };

/**
 * 品名から品目を解決する。部分一致は完全一致を包含するため、Notionへの問い合わせは
 * search 1回のみで済ませ、完全一致はメモリ上で優先する。
 */
const resolveItem = (arg: string): ResolveResult => {
  const matches = InventoryService.search(arg);
  const exact = matches.filter((item) => item.name === arg);
  if (exact.length > 0) {
    if (exact.length > 1) logError('commandRouter.resolveItem', `同名品目が複数: ${arg}`);
    return { kind: 'found', item: exact[0] };
  }
  if (matches.length === 1) return { kind: 'found', item: matches[0] };
  if (matches.length > 1) return { kind: 'candidates', items: matches };
  return { kind: 'notFound' };
};

/** 「なくなった」の実処理(postbackHandlerと共用)。すでに在庫切れなら通知しない */
export const executeOut = (item: InventoryItem, context: CommandContext): LineMessage[] => {
  if (!item.inStock) {
    return [textMessage(`${item.name} はすでに在庫切れです。`)];
  }
  InventoryService.setInStock(item.pageId, false);
  NotificationService.notifyOutOfStock({ ...item, inStock: false }, context.lineUserId);
  return [textMessage(`${item.name} を在庫切れにしました。みんなに知らせておきます 📢`)];
};

/** 「買った」の実処理(postbackHandlerと共用)。在庫ありのままでも購入は記録する */
export const executeBuy = (item: InventoryItem, context: CommandContext): LineMessage[] => {
  const wasInStock = item.inStock;
  if (!wasInStock) InventoryService.setInStock(item.pageId, true); // すでに在庫ありならno-op PATCHを省く
  NotificationService.notifyRestocked({ ...item, inStock: true }, context.lineUserId); // R-11

  const userPageId = UserService.findByLineUserId(context.lineUserId)?.pageId ?? null;
  try {
    PurchaseService.record(item, userPageId);
  } catch (err) {
    // フラグは更新済み: 履歴の記録失敗で無反応にせず、状況を伝える
    logError('commandRouter.executeBuy', err);
    return [textMessage(`${item.name} を在庫ありにしました(購入履歴の記録には失敗しました)。`)];
  }
  return [
    textMessage(wasInStock
      ? `${item.name} の購入を記録しました(在庫ありのままです)。`
      : `${item.name} を在庫ありにして、購入履歴に記録しました ✅`),
  ];
};

/** 購入履歴表示(postbackHandlerの「履歴」ボタンと共用) */
export const buildHistoryMessages = (item: InventoryItem): LineMessage[] => {
  const purchases = PurchaseService.listRecent(item.pageId, 5);
  if (purchases.length === 0) return [textMessage(`${item.name} の購入履歴はまだありません。`)];
  const lines = purchases.map((purchase) => `・${purchase.purchasedAt ?? '(日付不明)'}`).join('\n');
  return [textMessage(`${item.name} の購入履歴\n${lines}`)];
};

/**
 * 新規品目の登録(品名確定時)。作成後、詳細編集用のNotionページURLを案内する(R-14)。
 * 重複時は 'duplicate' を返し、文言は呼び出し側が文脈に合わせて決める。
 * messageHandler(品名入力)とhandleNew(「新規 品名」)から共用。
 */
export const beginNewItemFlow = (name: string, context: CommandContext): LineMessage[] | 'duplicate' => {
  try {
    const item = InventoryService.create({ name });
    SessionStore.set(context.lineUserId, { flow: 'attach_photo', step: 'wait', data: { pageId: item.pageId } });
    return [
      textMessage(
        `「${item.name}」を登録しました。\n\n` +
        `カテゴリ・購入先・メモなどの詳細はNotionで編集できます:\n${item.notionUrl}`,
      ),
      textMessage('続けて写真を送ると登録できます(不要なら「キャンセル」)。'),
    ];
  } catch (err) {
    if (isDuplicateItemError(err)) return 'duplicate';
    throw err;
  }
};

/** 品目のNotion編集ページへの誘導(「編集 品名」と旧カードの編集postbackで共用: R-14) */
export const buildEditLinkMessages = (item: InventoryItem): LineMessage[] => [
  textMessage(`「${item.name}」はNotionで編集できます(名前・カテゴリ・購入先・メモ・写真):\n${item.notionUrl}`),
];

/** 品目解決に失敗したときの共通メッセージ(候補があれば選択リストを付ける) */
const unresolvedMessages = (arg: string, result: ResolveResult, pickAction?: 'out' | 'buy'): LineMessage[] => {
  if (result.kind === 'candidates') {
    if (pickAction) {
      return [textMessage(`「${arg}」に該当する品目が複数あります。選んでください。`),
        FlexBuilder.buildPickListMessage(result.items, pickAction)];
    }
    const names = result.items.map((item) => `・${item.name}`).join('\n');
    return [textMessage(`「${arg}」に該当する品目が複数あります。正確な品名で送ってください。\n${names}`)];
  }
  return [textMessage(`「${arg}」が見つかりません。「在庫」で一覧を確認できます。`)];
};

const handleOut = (arg: string, context: CommandContext): LineMessage[] => {
  if (arg) {
    const result = resolveItem(arg);
    if (result.kind === 'found') return executeOut(result.item, context);
    return unresolvedMessages(arg, result, 'out');
  }
  const inStockItems = InventoryService.list().filter((item) => item.inStock);
  if (inStockItems.length === 0) return [textMessage('在庫ありの品目がありません。')];
  return [FlexBuilder.buildPickListMessage(inStockItems, 'out')];
};

const handleBuy = (arg: string, context: CommandContext): LineMessage[] => {
  if (arg) {
    const result = resolveItem(arg);
    if (result.kind === 'found') return executeBuy(result.item, context);
    return unresolvedMessages(arg, result, 'buy');
  }
  // 在庫切れがあればそこから選ばせる。1回のクエリで済ませ、メモリ上で絞る
  const allItems = InventoryService.list();
  if (allItems.length === 0) return [textMessage('品目が登録されていません。「新規 品名」で登録できます。')];
  const shortage = allItems.filter((item) => !item.inStock);
  return [FlexBuilder.buildPickListMessage(shortage.length > 0 ? shortage : allItems, 'buy')];
};

const handleNew = (arg: string, context: CommandContext): LineMessage[] => {
  if (!arg) {
    SessionStore.set(context.lineUserId, { flow: 'new', step: 'name' });
    return [textMessage('登録する品名を送ってください(やめる場合は「キャンセル」)。')];
  }
  const messages = beginNewItemFlow(arg, context);
  return messages === 'duplicate' ? [textMessage(`「${arg}」はすでに登録されています。`)] : messages;
};

const handleHistory = (arg: string): LineMessage[] => {
  if (!arg) return [textMessage('「履歴 品名」の形で送ってください。')];
  const result = resolveItem(arg);
  if (result.kind !== 'found') return unresolvedMessages(arg, result);
  return buildHistoryMessages(result.item);
};

const handleEdit = (arg: string): LineMessage[] => {
  if (!arg) return [textMessage('「編集 品名」の形で送ってください。')];
  const result = resolveItem(arg);
  if (result.kind !== 'found') return unresolvedMessages(arg, result);
  return buildEditLinkMessages(result.item);
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
      if (items.length === 0) return [textMessage('まだ品目が登録されていません。「新規 品名」で登録できます。')];
      return [FlexBuilder.buildItemListMessage('在庫一覧', items)];
    }
    case 'shortage': {
      const items = InventoryService.listShortage();
      if (items.length === 0) return [textMessage('不足はありません 🎉')];
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
      if (!parsed.arg) return [textMessage('「検索 キーワード」の形で送ってください。')];
      const items = InventoryService.search(parsed.arg);
      if (items.length === 0) return [textMessage(`「${parsed.arg}」は見つかりませんでした。`)];
      return [FlexBuilder.buildItemListMessage(`検索: ${parsed.arg}`, items)];
    }
    case 'edit':
      return handleEdit(parsed.arg);
    case 'help':
      return [FlexBuilder.buildHelpMessage()];
    case 'whoami':
      // 返信が届かない環境でもGASの実行ログから拾えるよう、ログにも残す
      logInfo('whoami', `lineUserId=${context.lineUserId}`);
      return [textMessage(`あなたのLINE User IDはこちらです(NotionのユーザーDBの「LINE User ID」列に貼り付けてください):\n\n${context.lineUserId}`)];
  }
};
