import { LineClient } from '../clients/lineClient';
import { UserService } from './userService';
import { logInfo, logError } from '../utils/logger';
import type { InventoryItem, LineMessage } from '../types';

/**
 * 報告者を除く有効ユーザー全員へメッセージ群を配信する。
 * 通知は副次処理: ユーザー一覧の取得を含め全体を握り、
 * 失敗しても呼び出し側のフラグ更新・返信を巻き戻さない。
 */
const notifyOthers = (messages: LineMessage[], reporterLineUserId: string | null, context: string): void => {
  try {
    const targets = UserService.listActive()
      .map((user) => user.lineUserId)
      .filter((id): id is string => Boolean(id) && id !== reporterLineUserId);

    // 切り分け容易化のため、対象数は常にログに残す(実装書16 タスクA)
    logInfo('NotificationService', `${context} → ${targets.length} user(s)`);
    if (targets.length === 0) return;

    LineClient.multicast(targets, messages);
  } catch (err) {
    logError(`NotificationService.${context}`, err);
  }
};

/** 品目に写真(httpsのURL)があれば画像メッセージを添える(R-12) */
const withPhoto = (item: InventoryItem, text: LineMessage): LineMessage[] =>
  item.photoUrl?.startsWith('https://')
    ? [text, { type: 'image', originalContentUrl: item.photoUrl, previewImageUrl: item.photoUrl }]
    : [text];

/** 在庫の増減を家族へ知らせる通知(F-16 / R-11 / R-12)。 */
export const NotificationService = {
  /** 在庫切れ通知。報告者(reporterLineUserId)には送らない。nullなら全員へ */
  notifyOutOfStock(item: InventoryItem, reporterLineUserId: string | null): void {
    const storeLine = item.stores.length > 0 ? `購入先: ${item.stores.join(' / ')}\n` : '';
    const text: LineMessage = {
      type: 'text',
      text:
        `【在庫切れ】${item.name} がなくなりました。\n` +
        storeLine +
        `買ったら「買った ${item.name}」と送ってください。`,
    };
    notifyOthers(withPhoto(item, text), reporterLineUserId, `notifyOutOfStock "${item.name}"`);
  },

  /** 購入(補充)通知(R-11)。報告者には送らない */
  notifyRestocked(item: InventoryItem, reporterLineUserId: string | null): void {
    const text: LineMessage = {
      type: 'text',
      text: `【補充】${item.name} を買ってきました 🛒`,
    };
    notifyOthers(withPhoto(item, text), reporterLineUserId, `notifyRestocked "${item.name}"`);
  },
};
