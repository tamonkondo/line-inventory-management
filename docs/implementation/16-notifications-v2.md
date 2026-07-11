# 実装書(16): 通知の改善 — 調査結果・買った通知(R-11)・写真添付(R-12)

- **依存**: 01〜11(実装済みコードへの追加改修)
- **対象ファイル**: `src/services/notificationService.ts`、`src/router/commandRouter.ts`、`src/types.ts`(変更なしの想定)、関連テスト
- **作成日**: 2026-07-11(実機検証で報告された症状に基づく)

---

## 1. 調査結果

### 症状A: 「なくなった」を送っても他ユーザーに通知が行かない

**実機での観測(重要)**: 「他ユーザー→自分」の通知は**届く**が、「自分→他ユーザー」は**届かない**という非対称な症状。

この非対称性から、**通知の仕組み(multicast・トークン・在庫フラグ連動)は正常に動いている**ことが確定する。
「他ユーザーが報告→自分に届く」= 通知対象の抽出とmulticastが機能しており、**自分の行(ステータス有効+正しいLINE User ID)は正しい**。

したがって原因は「**他ユーザー(家族)側の行のデータ**」にalmost確実に絞られる。通知対象は
`ユーザーDBの「ステータス=有効」かつ「LINE User IDが空でない」行 − 報告者自身` のため、以下のいずれかで家族が対象から漏れる:

| # | 原因候補 | 見分け方 |
| --- | --- | --- |
| 1 | 家族の行の **LINE User ID が空**(手動で行を作ってIDを入れていない) | `Boolean(id)` フィルタで除外 → ログに `no targets for ...` |
| 2 | 家族の行に**自分のIDを貼ってしまった**(「developツールで発行した本人のID」を両方の行にコピペ等) | 報告者除外(`id !== reporterLineUserId`)に該当して除外 → `no targets` |
| 3 | 家族の行の**ステータスが「有効」でない**(空・表記ゆれ「有効 」等) | フィルタで行ごと除外 → `no targets` |
| 4 | 家族のIDの**値が誤っている**(欠け・空白混入) | multicastが400 → `[ERROR][NotificationService...]` |

※ 家族側の行が壊れていても「家族が報告する」操作は一切失敗しない(報告処理は報告者の行を必要としない)ため、この非対称が起きる。

**確認・修正手順(コード変更不要)**:

1. 自分が「なくなった」を送った直後の doPost 実行ログを確認:
   - `no targets for ...` → 上表1〜3。NotionのユーザーDBで家族の行を確認する
   - `[ERROR][NotificationService...]` → 上表4
2. 修正はどちらかで:
   - **推奨**: 家族に Bot を**ブロック→ブロック解除**してもらう(followイベントで正しいIDの行が自動作成される。手動で作った壊れた行は削除)
   - または家族に「**ID**」と送ってもらい、返ってきたIDを家族の行のLINE User ID列へ正確に貼る
3. 修正後、自分が「なくなった」→家族に届くことを確認。

### 症状Aの再発防止(タスクAで対応)

対象者数が常にログに残らないため、この切り分けに手間がかかった。§2 タスクAの可観測性向上(対象数の常時ログ)で再発時にすぐ特定できるようにする。

### 症状B: 「買った」を押しても他ユーザーに通知が行かない

**仕様どおりの動作(機能が存在しない)。** 現行要件(F-16)は「なくなった」報告時のみ通知で、「買った」は本人への確認replyと購入履歴の記録のみ。
→ **新機能 R-11 として追加する**(下記 §2)。

---

## 2. 修正・追加タスク

### タスクA: 通知の可観測性向上(小修正)

`notifyOutOfStock` は現在、対象0件のときしかログを出さない。切り分けを容易にするため、**送信時にも対象数をログに残す**:

```ts
logInfo('NotificationService', `notify "${item.name}" → ${targets.length} user(s)`);
```

### タスクB(R-11): 「買った」の他ユーザー通知

**仕様**

- `executeBuy` の成功時(購入履歴の記録が成功したかに関わらず、フラグ操作が完了した時点)に、**報告者を除く有効ユーザー全員**へ通知する。
- 文言案: `【補充】<品名> を買ってきました 🛒`(購入先は不要。なくなった通知との文言の違いで区別できること)
- なくなった通知と同じ抑制なし・握りつぶし方針(通知失敗で主処理を巻き戻さない)。

**実装**

`notificationService.ts` に `notifyRestocked(item, reporterLineUserId)` を追加する。
`notifyOutOfStock` と対象抽出・エラーハンドリングが共通なので、**内部関数に括り出す**:

```ts
/** 報告者を除く有効ユーザーへメッセージ群を配信(失敗はログのみ) */
const notifyOthers = (messages: LineMessage[], reporterLineUserId: string | null, context: string): void => { ... };

export const NotificationService = {
  notifyOutOfStock(item, reporterLineUserId): void { /* 文言組み立て → notifyOthers */ },
  notifyRestocked(item, reporterLineUserId): void { /* 文言組み立て → notifyOthers */ },
};
```

呼び出し側(`commandRouter.ts` の `executeBuy`):

```ts
InventoryService.setInStock(...);          // 既存(在庫切れ→ありの場合のみ)
NotificationService.notifyRestocked(item, context.lineUserId);  // ★追加
PurchaseService.record(...);               // 既存
```

- **在庫ありのまま買い足した場合も通知するか** → **する**(「買ってきた」共有が目的のため)。ただし将来うるさければオフにできるよう、notifyRestocked呼び出しは1箇所に集約しておく。

### タスクC(R-12): 通知への商品写真の添付

**仕様**

- 品目に写真がある場合、通知テキストに**画像メッセージを添えて**送る(なくなった通知・買った通知の両方に適用)。
- LINEの画像メッセージ形式: `{ type: 'image', originalContentUrl, previewImageUrl }`(どちらも**httpsのURL必須**)。
- `item.photoUrl`(Notionの署名付きURL)をそのまま両方に使う。previewの縮小版は作らない(Notionは1URLのみのため)。

**実装**

1. `src/types.ts` の `LineMessage` 型に image を追加:
   ```ts
   | { type: 'image'; originalContentUrl: string; previewImageUrl: string }
   ```
2. `notificationService.ts` に共通ヘルパー:
   ```ts
   const withPhoto = (item: InventoryItem, text: LineMessage): LineMessage[] =>
     item.photoUrl?.startsWith('https://')
       ? [text, { type: 'image', originalContentUrl: item.photoUrl, previewImageUrl: item.photoUrl }]
       : [text];
   ```
3. `notifyOutOfStock` / `notifyRestocked` の送信メッセージを `withPhoto(...)` にする。

**既知の制約(仕様として許容)**: Notionの署名付きURLは約1時間で失効する。通知は届いた直後に見るのが通常のため実用上の支障は小さいが、**古い通知を遡ると画像が表示されない**ことがある(実装書15 §7-2と同じ制約)。

> 注意: `executeOut` は通知に `{ ...item, inStock: false }` を渡している。photoUrlはスプレッドで引き継がれるため追加対応不要。

---

## 3. 受け入れ基準

- [ ] (A) 通知送信時に `notify "<品名>" → N user(s)` がログに出る。
- [ ] (B) 2アカウント環境で、Aが「買った」→ Bに「【補充】...」が届き、Aには届かない。
- [ ] (B) 報告者しかいない環境では送信スキップ(エラーにならない)。
- [ ] (B) 通知失敗(LINE障害)でも購入記録と本人へのreplyは完了する。
- [ ] (C) 写真ありの品目で「なくなった」→ 通知にテキスト+画像の2通が届く。
- [ ] (C) 写真なしの品目ではテキストのみ(例外にならない)。
- [ ] 既存テストがパスし、notifyRestocked / withPhoto のユニットテストが追加されている。
- [ ] `npm run typecheck` / `npm test` / `npm run build` が通る。

## 4. E2Eチェックリスト追加分(実装書15 §5へ)

| # | 操作 | 期待結果 |
| --- | --- | --- |
| 21 | Aが写真付き品目を「なくなった」 | Bにテキスト+写真の通知が届く |
| 22 | Aがリッチメニュー「買った」→品目選択 | Bに「【補充】...」が届く。Aには届かない |
