import { UserService } from '../services/userService';
import { LineClient } from '../clients/lineClient';
import type { LineWebhookEvent } from '../types';

/** 友だち追加イベントを処理する(F-13)。 */
export const handleFollow = (event: LineWebhookEvent): void => {
  const userId = event.source.userId;
  if (!userId || !event.replyToken) return; // グループ等、userIdがないソースは対象外
  const user = UserService.register(userId);
  LineClient.reply(event.replyToken, [{
    type: 'text',
    text:
      `${user.name}さん、追加ありがとうございます!\n` +
      '家庭の在庫をみんなで管理するBotです。\n\n' +
      '下のメニューから操作できます。\n' +
      '・在庫一覧 / 不足一覧\n' +
      '・なくなった / 買った の報告\n' +
      '・新規登録\n\n' +
      '「ヘルプ」と送るとコマンド一覧が見られます。',
  }]);
};

/** ブロック(友だち解除)イベントを処理する(F-15)。unfollowにreplyTokenはない。 */
export const handleUnfollow = (event: LineWebhookEvent): void => {
  const userId = event.source.userId;
  if (!userId) return;
  UserService.deactivate(userId);
};
