# 実装書(10): コマンドパーサー・ルーター

- **依存**: 07, 08, 09, 12
- **対象ファイル**: `src/utils/parse.ts`(新規)、`src/router/commandRouter.ts`(新規)。旧 `.js` 2ファイルを削除

## 目的

テキストメッセージを「コマンド+引数」に解釈し、対応するサービスを呼び出して返信メッセージを組み立てる。

## 1. `src/utils/parse.ts`

```ts
export type CommandName =
  | 'list' | 'shortage' | 'out' | 'buy' | 'new'
  | 'history' | 'search' | 'edit' | 'help';

export interface ParsedCommand {
  command: CommandName;
  arg: string; // 引数なしは ''
}

/** 「なくなった 食器用洗剤」等をコマンドと引数に分解する。コマンドでなければnull */
export const parseCommand = (text: string): ParsedCommand | null => { ... };
```

処理手順:

1. 正規化: `text.trim()`、全角スペース(U+3000)を半角に置換、連続空白を1つに。
2. 最初の空白で分割: 先頭トークン=コマンド候補、残り全体=引数(なければ `''`)。
3. コマンド候補を**別名テーブル**で正規名に解決する。テーブルにない場合は `null`。

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

別名テーブルはモジュール先頭に定義する:

```ts
const COMMAND_ALIASES: Record<string, CommandName> = {
  '在庫': 'list', '一覧': 'list', '在庫一覧': 'list',
  '不足': 'shortage', /* ...上表のとおり */
};
```

## 2. `src/router/commandRouter.ts`

```ts
import type { CommandContext, InventoryItem, LineMessage } from '../types';

/**
 * コマンドを解釈してサービスを呼び、返信メッセージ配列を返す。
 * コマンドでなければ null(呼び出し側がフォールバック)。
 * 返信自体はしない(reply は messageHandler の責務)。
 */
export const routeCommand = (text: string, context: CommandContext): LineMessage[] | null => { ... };

/** 「なくなった」の実処理(postbackHandlerと共用: 実装書11) */
export const executeOut = (item: InventoryItem, context: CommandContext): LineMessage[] => { ... };

/** 「買った」の実処理(postbackHandlerと共用: 実装書11) */
export const executeBuy = (item: InventoryItem, context: CommandContext): LineMessage[] => { ... };
```

### 2.1 各コマンドの仕様

**`list`** — `InventoryService.list()` → 0件なら「まだ品目が登録されていません。「新規 品名」で登録できます。」のテキスト。あれば `FlexBuilder.buildItemListMessage('在庫一覧', items)`。

**`shortage`** — `InventoryService.listShortage()` → 0件なら「不足はありません 🎉」。あれば `buildItemListMessage('不足一覧', items)`。

**`out`(なくなった)**
- 引数あり: `resolveItem(arg)`(後述)で品目解決 → `executeOut(item, context)`。
- 引数なし: 在庫ありの品目から選ばせる → `FlexBuilder.buildPickListMessage(list().filter((i) => i.inStock), 'out')`。0件なら「在庫ありの品目がありません」。

`executeOut` の中身:
- `item.inStock === false` → 「(品名)はすでに在庫切れです」(**通知しない**。連打対策)。
- 正常: `InventoryService.setInStock(pageId, false)` → `NotificationService.notifyOutOfStock(item, context.lineUserId)` → 「(品名)を在庫切れにしました。みんなに知らせておきます 📢」。

**`buy`(買った)**
- 引数あり: 品目解決 → `executeBuy(item, context)`。
- 引数なし: 在庫切れ品目から選ばせる → `buildPickListMessage(listShortage(), 'buy')`。在庫切れ0件なら全品目から。

`executeBuy` の中身:
- `InventoryService.setInStock(pageId, true)` → `PurchaseService.record(item, userPageId)` → 「(品名)を在庫ありにして、購入履歴に記録しました ✅」。
  - `userPageId` は `UserService.findByLineUserId(context.lineUserId)?.pageId ?? null`。
- すでに在庫ありでも**記録は行う**(買い足しはあり得る)。文言「(品名)の購入を記録しました(在庫ありのままです)」。

**`new`(新規登録)**
- 引数あり: `InventoryService.create({ name: arg })`。
  - `DUPLICATE_ITEM` → 「「arg」はすでに登録されています」。
  - 成功 → 「「arg」を登録しました。」+ `buildItemCard(item)` + 「続けて写真を送ると登録できます」→ **セッション** `{ flow: 'attach_photo', step: 'wait', data: { pageId } }` をセット(実装書11のSessionStore)。
- 引数なし: セッション `{ flow: 'new', step: 'name' }` をセットし「登録する品名を送ってください」。

**`history`** — 品目解決後 `PurchaseService.listRecent(pageId, 5)` → 0件「購入履歴はまだありません」。あれば「(品名)の購入履歴\n・YYYY-MM-DD\n・...」のテキスト。引数なしは「「履歴 品名」の形で送ってください」。

**`search`** — `InventoryService.search(arg)` → buildItemListMessage。0件は「見つかりませんでした」。

**`edit`** — 品目解決後、`FlexBuilder.buildEditMenuMessage(item)`(名前/購入先/写真の変更ボタン。実装書11のpostbackへ)。

**`help`** — `FlexBuilder.buildHelpMessage()`。

### 2.2 品目解決ヘルパー(モジュール内・非export)

`out`/`buy`/`history`/`edit` で共通:

```ts
type ResolveResult =
  | { kind: 'found'; item: InventoryItem }
  | { kind: 'candidates'; items: InventoryItem[] }
  | { kind: 'notFound' };

const resolveItem = (arg: string): ResolveResult => {
  // 1. findByName(完全一致) → found
  // 2. search(部分一致)が1件 → found
  // 3. 2件以上 → candidates(呼び出し側がbuildPickListMessageで提示)
  // 4. 0件 → notFound
};
```

## 3. 受け入れ基準

- [ ] 上表の全別名が正規コマンドに解決される。全角スペース区切りも動く。
- [ ] コマンドでないテキスト(「こんにちは」)で `routeCommand` が `null` を返す。
- [ ] 「なくなった 食器用洗剤」で: フラグOFF+他ユーザーへ通知+確認reply。
- [ ] すでに在庫切れの品目への「なくなった」で通知が飛ばない。
- [ ] 「買った 食器用洗剤」で: フラグON+購入履歴1件+確認reply。
- [ ] 「新規 トイレットペーパー」→ 登録され、重複時はエラーメッセージ。
- [ ] `routeCommand` 内で `LineClient.reply` を呼んでいない(メッセージを返すだけ)。
- [ ] `executeOut` / `executeBuy` がexportされている(実装書11が使う)。
- [ ] `npm run typecheck` が通る。

## 4. 動作確認方法

`parseCommand` は純関数なので直接テスト:

```ts
export const test_parse = (): void => {
  logInfo('t1', parseCommand('なくなった 食器用洗剤')); // {command:'out', arg:'食器用洗剤'}
  logInfo('t2', parseCommand('在庫'));                   // {command:'list', arg:''}
  logInfo('t3', parseCommand('こんにちは'));             // null
  logInfo('t4', parseCommand('買った　トイレットペーパー')); // 全角スペース → {command:'buy', ...}
};
```

routeCommandは実装書11結線後にLINE実機で確認する。
