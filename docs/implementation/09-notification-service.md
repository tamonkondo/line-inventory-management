# 実装書(09): 通知サービス — 在庫切れ即時通知

- **依存**: 03, 06
- **対象ファイル**: `src/services/notificationService.ts`(新規)。旧 `.js` を削除

## 目的

「なくなった」報告の瞬間に、有効ユーザー全員(報告者を除く)へLINE Pushで知らせる(F-16 / F-11)。

## 1. 実装内容

```ts
import { LineClient } from '../clients/lineClient';
import { UserService } from './userService';
import { logInfo, logError } from '../utils/logger';
import type { InventoryItem } from '../types';

/** 在庫切れ通知を組み立て、対象ユーザーへ配信する(F-16)。 */
export const NotificationService = {
  /**
   * @param item 在庫切れになった品目
   * @param reporterLineUserId 報告者(通知から除外する)。nullなら全員へ
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
      // 通知失敗で本処理(フラグ更新)を巻き戻さない。ログのみ。
      logError('NotificationService.notifyOutOfStock', err);
    }
  },
};
```

## 2. 仕様メモ

- **報告者は除外**する(報告者には reply で確認メッセージが返る。二重に届かせない)。
- 通知はテキストで十分(Flexにしない)。品目の購入先が設定されていれば添える。
- multicastの失敗は握りつぶす(在庫フラグの更新が主処理。通知は副次)。呼び出し側は成否を気にしなくてよい。
- 通知の抑制ルール(連打対策)は初期実装では入れない。すでに在庫切れの品目への再報告の抑止は呼び出し側(実装書10/11)で行う。

## 3. 受け入れ基準

- [ ] 有効ユーザー2人以上の状態で「なくなった」を実行すると、報告者以外に通知が届く。
- [ ] 報告者には届かない。無効ユーザーにも届かない。
- [ ] 対象0人(1人暮らし等)でも例外にならない。
- [ ] LINE API障害を模擬(トークンを一時的に壊す)しても例外が上に漏れない。
- [ ] `npm run typecheck` が通る。

## 4. 動作確認方法

LINEアカウント2つ(家族の端末等)でBotを友だち追加した上で、片方から「なくなった <品名>」を送り、もう片方だけに通知が届くことを確認する。
