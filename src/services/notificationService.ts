import { LineClient } from '../clients/lineClient';
import { UserService } from './userService';
import { logInfo, logError } from '../utils/logger';
import type { InventoryItem } from '../types';

/** 在庫切れ通知を組み立て、対象ユーザーへ配信する(F-16)。 */
export const NotificationService = {
  /**
   * 有効ユーザー全員(報告者を除く)へ在庫切れをPush通知する。
   * 通知は副次処理: 失敗しても例外を上に漏らさない(在庫フラグ更新を巻き戻さない)。
   * @param item 在庫切れになった品目
   * @param reporterLineUserId 報告者(通知から除外)。nullなら全員へ
   */
  notifyOutOfStock(item: InventoryItem, reporterLineUserId: string | null): void {
    const targets = UserService.listActive()
      .map((user) => user.lineUserId)
      .filter((id): id is string => Boolean(id) && id !== reporterLineUserId);

    if (targets.length === 0) {
      logInfo('NotificationService', `no targets for ${item.name}`);
      return;
    }

    const storeLine = item.stores.length > 0 ? `購入先: ${item.stores.join(' / ')}\n` : '';
    const text =
      `【在庫切れ】${item.name} がなくなりました。\n` +
      storeLine +
      `買ったら「買った ${item.name}」と送ってください。`;

    try {
      LineClient.multicast(targets, [{ type: 'text', text }]);
    } catch (err) {
      logError('NotificationService.notifyOutOfStock', err);
    }
  },
};
