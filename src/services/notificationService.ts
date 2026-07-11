import { LineClient } from '../clients/lineClient';
import { UserService } from './userService';
import { logInfo, logError } from '../utils/logger';
import type { InventoryItem, LineMessage } from '../types';

/**
 * 報告者を除く有効ユーザー全員へ通知を配信する。
 * 通知は副次処理: ユーザー一覧の取得を含め全体を握り、
 * 失敗しても呼び出し側のフラグ更新・返信を巻き戻さない。
 * 写真(R-12)は本文とは別便で送り、画像URLの不備が本文の配信を道連れにしないようにする。
 */
const notifyOthers = (item: InventoryItem, text: LineMessage, reporterLineUserId: string | null, context: string): void => {
  let targets: string[];
  try {
    targets = UserService.listActive()
      .map((user) => user.lineUserId)
      .filter((id): id is string => Boolean(id) && id !== reporterLineUserId);
  } catch (err) {
    logError(`NotificationService.${context}`, err);
    return;
  }

  // 切り分け容易化のため、対象数は常にログに残す(実装書16 タスクA)
  logInfo('NotificationService', `${context} → ${targets.length} user(s)`);
  if (targets.length === 0) return;

  try {
    LineClient.multicast(targets, [text]);
  } catch (err) {
    logError(`NotificationService.${context}:text`, err);
    return; // 本文が送れなければ写真も送らない
  }

  if (item.photoUrl?.startsWith('https://')) {
    try {
      LineClient.multicast(targets, [{
        type: 'image',
        originalContentUrl: item.photoUrl,
        previewImageUrl: item.photoUrl,
      }]);
    } catch (err) {
      // 写真はベストエフォート: 失敗しても本文は届いている
      logError(`NotificationService.${context}:photo`, err);
    }
  }
};

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
    notifyOthers(item, text, reporterLineUserId, `notifyOutOfStock "${item.name}"`);
  },

  /** 購入(補充)通知(R-11)。報告者には送らない */
  notifyRestocked(item: InventoryItem, reporterLineUserId: string | null): void {
    const text: LineMessage = {
      type: 'text',
      text: `【補充】${item.name} を買ってきました 🛒`,
    };
    notifyOthers(item, text, reporterLineUserId, `notifyRestocked "${item.name}"`);
  },
};
