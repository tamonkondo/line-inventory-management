# 実装書(09): 通知サービス — 在庫切れ即時通知

- **依存**: 03, 06
- **対象ファイル**: `src/services/notificationService.js`(実装)

## 目的

「なくなった」報告の瞬間に、有効ユーザー全員(報告者を除く)へLINE Pushで知らせる(F-16 / F-11)。

## 1. 実装内容

雛形の `notifyShortage` は**リネーム**し、以下にする。

```js
/** 在庫切れ通知を組み立て、対象ユーザーへ配信する(F-16)。 */
var NotificationService = {
  /**
   * @param {InventoryItem} item 在庫切れになった品目
   * @param {string|null} reporterLineUserId 報告者(通知から除外する)。nullなら全員へ
   */
  notifyOutOfStock: function (item, reporterLineUserId) {
    var targets = UserService.listActive()
      .map(function (u) { return u.lineUserId; })
      .filter(function (id) { return id && id !== reporterLineUserId; });

    if (targets.length === 0) {
      logInfo('NotificationService', 'no targets for ' + item.name);
      return;
    }

    var text = '【在庫切れ】' + item.name + ' がなくなりました。\n' +
               (item.stores && item.stores.length
                 ? '購入先: ' + item.stores.join(' / ') + '\n' : '') +
               '買ったら「買った ' + item.name + '」と送ってください。';

    try {
      LineClient.multicast(targets, [{ type: 'text', text: text }]);
    } catch (err) {
      // 通知失敗で本処理(フラグ更新)を巻き戻さない。ログのみ。
      logError('NotificationService.notifyOutOfStock', err);
    }
  }
};
```

## 2. 仕様メモ

- **報告者は除外**する(報告者には reply で確認メッセージが返る。二重に届かせない)。
- 通知はテキストで十分(Flexにしない)。品目の購入先が設定されていれば添える。
- multicastの失敗は握りつぶす(在庫フラグの更新が主処理。通知は副次)。呼び出し側は成否を気にしなくてよい。
- 通知の抑制ルール(連打対策)は初期実装では入れない。すでに在庫切れの品目に再度「なくなった」した場合の抑止は呼び出し側(実装書11)で行う。

## 3. 受け入れ基準

- [ ] 有効ユーザー2人以上の状態で「なくなった」を実行すると、報告者以外に通知が届く。
- [ ] 報告者には届かない。
- [ ] 無効ユーザーには届かない。
- [ ] 対象0人(1人暮らし等)でも例外にならない。
- [ ] LINE API障害を模擬(トークンを一時的に壊す)しても例外が上に漏れない。

## 4. 動作確認方法

LINEアカウント2つ(家族の端末等)でBotを友だち追加した上で、片方から「なくなった <品名>」を送り、もう片方だけに通知が届くことを確認する。
