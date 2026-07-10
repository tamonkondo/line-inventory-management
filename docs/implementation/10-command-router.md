# 実装書(10): コマンドパーサー・ルーター

- **依存**: 07, 08, 09, 12
- **対象ファイル**: `src/utils/parse.js`(実装)、`src/router/commandRouter.js`(実装)

## 目的

テキストメッセージを「コマンド+引数」に解釈し、対応するサービスを呼び出して返信メッセージを組み立てる。

## 1. `src/utils/parse.js`

```js
/**
 * 「なくなった 食器用洗剤」等をコマンドと引数に分解する。
 * @return {{command: string, arg: string}|null} コマンドでなければnull
 */
function parseCommand(text) { ... }
```

処理手順:

1. 正規化: `text.trim()`、全角スペース(U+3000)を半角に置換、連続空白を1つに。
2. 最初の空白で分割: 先頭トークン=コマンド候補、残り全体=引数(`arg`。なければ `''`)。
3. コマンド候補を**別名テーブル**で正規名に解決する。テーブルにない場合は `null` を返す。

| 正規名 | 別名(すべて受け付ける) | 引数 |
| --- | --- | --- |
| `list` | 在庫, 一覧, 在庫一覧 | なし |
| `shortage` | 不足, 不足一覧, 買い物, 買い物リスト | なし |
| `out` | なくなった, 切れた, ない | 品名(任意) |
| `buy` | 買った, 買いました, 購入 | 品名(任意) |
| `new` | 新規, 新規登録, 登録 | 品名(任意) |
| `history` | 履歴 | 品名(必須) |
| `search` | 検索 | キーワード(必須) |
| `edit` | 編集, 変更 | 品名(必須) |
| `help` | ヘルプ, help, 使い方 | なし |

別名テーブルはファイル先頭に定数 `COMMAND_ALIASES` として定義する。

## 2. `src/router/commandRouter.js`

```js
/**
 * コマンドを解釈してサービスを呼び、返信メッセージ配列を返す。
 * @param {string} text ユーザーの発言
 * @param {{lineUserId: string}} context
 * @return {Object[]|null} LINEメッセージ配列。コマンドでなければnull(呼び出し側がフォールバック)
 */
function routeCommand(text, context) { ... }
```

`parseCommand` の結果で分岐する。**返信はしない(メッセージ配列を返すだけ)**。reply は messageHandler の責務。

### 2.1 各コマンドの仕様

**`list`** — `InventoryService.list()` → 0件なら「まだ品目が登録されていません。「新規 品名」で登録できます。」のテキスト。あれば `FlexBuilder.buildItemListMessage('在庫一覧', items)`。

**`shortage`** — `InventoryService.listShortage()` → 0件なら「不足はありません 🎉」。あれば `FlexBuilder.buildItemListMessage('不足一覧', items)`。

**`out`(なくなった)**
- 引数あり: `findByName(arg)`。
  - 見つからない → `search(arg)` で部分一致を試し、1件だけならそれを対象にする。0件or複数なら「「arg」が見つかりません/複数あります。在庫一覧から選んでください」+ `FlexBuilder.buildPickListMessage(候補, 'out')`。
  - 対象が既に `inStock === false` → 「(品名)はすでに在庫切れです」(通知しない。連打対策)。
  - 正常: `InventoryService.setInStock(pageId, false)` → `NotificationService.notifyOutOfStock(item, context.lineUserId)` → 「(品名)を在庫切れにしました。みんなに知らせておきます 📢」。
- 引数なし: 在庫ありの品目一覧から選ばせる → `FlexBuilder.buildPickListMessage(InventoryService.list().filter(inStock), 'out')`。0件なら「在庫ありの品目がありません」。

**`buy`(買った)**
- 引数あり: `out` と同様に品目解決。
  - 正常: `InventoryService.setInStock(pageId, true)` → `PurchaseService.record(item, userPageId)` → 「(品名)を在庫ありにして、購入履歴に記録しました ✅」。
    - `userPageId` は `UserService.findByLineUserId(context.lineUserId)` から取る(nullなら記録者なしで記録)。
  - すでに在庫ありでも**記録は行う**(買い足しはあり得る)。文言「(品名)の購入を記録しました(在庫ありのままです)」。
- 引数なし: 在庫切れ品目から選ばせる → `buildPickListMessage(listShortage(), 'buy')`。在庫切れ0件なら全品目から選ばせる。

**`new`(新規登録)**
- 引数あり: `InventoryService.create({name: arg})`。
  - `DUPLICATE_ITEM` 例外 → 「「arg」はすでに登録されています」。
  - 成功 → 「「arg」を登録しました。」+ `FlexBuilder.buildItemCard(item)` + 「続けて写真を送ると登録できます」→ **セッション** `{flow:'attach_photo', step:'wait', data:{pageId}}` をセット(実装書11のSessionStoreを使用)。
- 引数なし: セッション `{flow:'new', step:'name', data:{}}` をセットし「登録する品名を送ってください」(以降は実装書11のフロー)。

**`history`** — 品目解決後 `PurchaseService.listRecent(pageId, 5)` → 0件「購入履歴はまだありません」。あれば「(品名)の購入履歴\n・YYYY-MM-DD\n・...」のテキスト+最終購入日。引数なしは「「履歴 品名」の形で送ってください」。

**`search`** — `InventoryService.search(arg)` → buildItemListMessage。0件は「見つかりませんでした」。

**`edit`** — 品目解決後、`FlexBuilder.buildEditMenuMessage(item)`(名前/購入先/写真の変更ボタン。実装書11のpostbackへ)。

**`help`** — `FlexBuilder.buildHelpMessage()`。

### 2.2 共通ヘルパー

品目解決(完全一致→部分一致1件→候補提示)は `out`/`buy`/`history`/`edit` で共通なので、`resolveItem_(arg)` として括り出す:

```js
/** @return {{item: InventoryItem}|{candidates: InventoryItem[]}|{notFound: true}} */
function resolveItem_(arg) { ... }
```

## 3. 受け入れ基準

- [ ] 上表の全別名が正規コマンドに解決される。全角スペース区切りも動く。
- [ ] コマンドでないテキスト(「こんにちは」)で `routeCommand` が `null` を返す。
- [ ] 「なくなった 食器用洗剤」で: フラグOFF+他ユーザーへ通知+確認reply。
- [ ] すでに在庫切れの品目への「なくなった」で通知が飛ばない。
- [ ] 「買った 食器用洗剤」で: フラグON+購入履歴1件+確認reply。
- [ ] 「新規 トイレットペーパー」→ 登録され、重複時はエラーメッセージ。
- [ ] routeCommand内で `LineClient.reply` を呼んでいない(メッセージを返すだけ)。

## 4. 動作確認方法

`parseCommand` は純関数なのでGASエディタで直接テスト:

```js
function test_parse() {
  logInfo('t1', parseCommand('なくなった 食器用洗剤')); // {command:'out', arg:'食器用洗剤'}
  logInfo('t2', parseCommand('在庫'));                  // {command:'list', arg:''}
  logInfo('t3', parseCommand('こんにちは'));            // null
  logInfo('t4', parseCommand('買った　トイレットペーパー')); // 全角スペース → {command:'buy', ...}
}
```

routeCommandは実装書11結線後にLINE実機で確認する。
