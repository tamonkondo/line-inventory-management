# 実装計画書(00): 全体計画

- **対象**: LINE × Notion 在庫管理 Bot(GAS)の初期実装
- **根拠ドキュメント**: `docs/requirements.md`(v1.0 + v1.1 / R-08 boolean管理)、`docs/notion-schema.md`
- **作成日**: 2026-07-10(TypeScript化に伴い改訂)

---

## 1. ゴール

LINE Bot から以下が行える状態を作る。

1. 在庫一覧・不足一覧(在庫切れのみ)の表示
2. 「なくなった」報告 → 在庫切れフラグON+有効ユーザー全員へ即時通知
3. 「買った」報告 → 在庫ありフラグON+購入履歴を記録
4. 新規品目の登録(LINEから)
5. 品目の写真・名前・購入先のLINEからの変更(それ以外の編集はNotion画面で行う)
6. 友だち追加によるユーザー自動登録、ブロックによる無効化
7. リッチメニュー(6ボタン)からの操作導線

**在庫は boolean(在庫あり Checkbox)で管理する。数量・しきい値は実装しない。**

## 2. 技術前提・コーディング規約

### 2.1 言語・ビルド

- **実装言語は TypeScript**(`src/**/*.ts`)。既存の `.js` 雛形は実装書01で `.ts` に置き換えて削除する。
- clasp 3.x はTypeScriptの自動変換を廃止しているため、**esbuild でバンドルして `dist/` を GAS へ push** する:
  - `src/index.ts` を単一エントリとして `esbuild` + `esbuild-gas-plugin` で `dist/main.js` にバンドル
  - `appsscript.json` をビルド時に `dist/` へコピー
  - `.clasp.json` は `"rootDir": "dist"` を指定(`.claspignore` は削除)
- セットアップ詳細(package.json / tsconfig.json / esbuild.mjs)は実装書01を正とする。
- 検証コマンド: `npm run typecheck`(tsc --noEmit)と `npm run build` が通ること。

### 2.2 コーディングスタイル

- **`var` 禁止。再代入しない限り `const`、必要な場合のみ `let`。**
- モジュールは **ES Modules(`import` / `export`)**。バンドルするのでGAS上でも問題ない。
- モジュール内の非公開関数は export しないことで隠蔽する(旧規約の `_` サフィックスは**廃止**)。
- 文字列結合はテンプレートリテラル、コレクション操作は `map` / `filter` / アロー関数を基本とする。
- `tsconfig.json` は `"strict": true`。`any` は原則禁止(外部APIレスポンスの受け口は `unknown` で受けて絞り込むか、専用型を定義)。
- ドメインの型は `src/types.ts` に集約し、各モジュールはそこから import する。
- サービス/クライアントは `export const InventoryService = { ... }` のようなオブジェクトとして公開する(既存契約の呼び出し形を維持)。
- GASのグローバル関数(`doPost` 等、GASエディタ・トリガーから見える必要があるもの)は **`src/index.ts` で `global` に束縛したものだけ**が公開される(esbuild-gas-plugin の仕組み)。
- 機密値・設定値はすべて `CONFIG`(スクリプトプロパティ)経由。**コード直書き禁止**。必要なキーは `.env.example` に列挙されている(ローカル控え用。実行時はスクリプトプロパティ)。
- Notion のプロパティ名は `src/config.ts` の `NOTION_PROPS` 定数(`as const`)に集約する。
- 外部API呼び出しは `UrlFetchApp.fetch` + `muteHttpExceptions: true` とし、ステータスコードを必ず確認する。
- ログは `logInfo` / `logError` を必ず経由する(`console.log` 直書き禁止)。

## 3. アーキテクチャとファイル構成

```
LINE → doPost(main.ts) → 署名検証(utils/signature.ts)
     → イベント振り分け
         message  → handlers/messageHandler.ts ─┬→ セッション継続(utils/sessionStore.ts)
         postback → handlers/postbackHandler.ts ─┤
         follow   → handlers/followHandler.ts    │
     → router/commandRouter.ts(テキストコマンド)│
     → services/*(業務ロジック)◀───────────────┘
         inventoryService / purchaseService / userService / notificationService
     → clients/*(外部API)
         lineClient(LINE Messaging API) / notionClient(Notion API)
     → messages/flexBuilder.ts(表示組み立て)
```

| ファイル | 状態 | 担当実装書 |
| --- | --- | --- |
| `package.json` / `tsconfig.json` / `esbuild.mjs` / `.claspignore`(削除) | ビルド基盤 | 01 |
| `src/index.ts`(globalへの束縛) | **新規** | 01 |
| `src/types.ts`(ドメイン型) | **新規** | 01 |
| `src/config.ts` | 移行+拡張 | 01 |
| `src/utils/logger.ts` | 実装 | 01 |
| `src/utils/signature.ts` | 実装 | 02 |
| `src/main.ts` | 移行 | 02 |
| `src/clients/lineClient.ts` | 実装 | 03 |
| `src/clients/notionClient.ts` | 移行+拡張 | 04 |
| `src/utils/notionMapper.ts` | **新規** | 05 |
| `src/services/userService.ts` | 実装 | 06 |
| `src/handlers/followHandler.ts` | 実装 | 06 |
| `src/services/inventoryService.ts` | **書き換え**(boolean化) | 07 |
| `src/services/purchaseService.ts` | **新規** | 08 |
| `src/services/notificationService.ts` | 実装 | 09 |
| `src/utils/parse.ts` | 実装 | 10 |
| `src/router/commandRouter.ts` | 実装 | 10 |
| `src/utils/sessionStore.ts` | **新規** | 11 |
| `src/handlers/postbackHandler.ts` | 実装 | 11 |
| `src/handlers/messageHandler.ts` | 実装 | 11 |
| `src/messages/flexBuilder.ts` | 実装 | 12 |
| `src/handlers/imageHandler.ts` | **新規** | 13 |
| `assets/richmenu/richmenu.json` | 実装 | 14 |
| `src/setup/richMenuSetup.ts` | **新規** | 14 |
| (手順書・E2Eチェックリスト) | - | 15 |

## 4. タスク一覧と依存関係

| # | 実装書 | 内容 | 依存 |
| --- | --- | --- | --- |
| 01 | `01-foundation.md` | **TSビルド基盤**・types・config・NOTION_PROPS・logger・index.ts | なし |
| 02 | `02-webhook-entry.md` | 署名検証・main.ts | 01 |
| 03 | `03-line-client.md` | LINE APIクライアント | 01 |
| 04 | `04-notion-client.md` | Notion APIクライアント(汎用+File Upload) | 01 |
| 05 | `05-notion-mapper.md` | Notionページ⇔ドメインオブジェクト変換 | 01 |
| 06 | `06-user-service.md` | ユーザー登録・無効化・follow/unfollow | 03, 04, 05 |
| 07 | `07-inventory-service.md` | 在庫サービス(boolean管理) | 04, 05 |
| 08 | `08-purchase-service.md` | 購入履歴サービス | 04, 05, 07 |
| 09 | `09-notification-service.md` | 在庫切れ通知 | 03, 06 |
| 10 | `10-command-router.md` | コマンドパーサー・ルーター | 07, 08, 09, 12 |
| 11 | `11-conversation-flows.md` | セッション管理・postback/messageハンドラ | 07, 08, 09, 10, 12 |
| 12 | `12-flex-builder.md` | Flexメッセージ組み立て | 01(型のみ) |
| 13 | `13-photo-upload.md` | 写真登録(LINE画像→Notion) | 03, 04, 07, 11 |
| 14 | `14-rich-menu.md` | リッチメニュー定義・登録スクリプト | 03 |
| 15 | `15-setup-e2e.md` | Notion DB作成・デプロイ・E2E検証 | 全部 |

**推奨実装順**: 01 → (02, 03, 04, 05 は並行可) → (06, 07, 12 は並行可) → 08, 09 → 10 → 11 → 13, 14 → 15

## 5. 共有インターフェース(全実装書共通の契約)

タスクを並行実装しても噛み合うよう、境界となる型と関数シグネチャをここで確定する。
**各実装書はこの契約に従うこと。変更したくなった場合はこの計画書を先に更新する。**

### 5.1 ドメイン型(`src/types.ts`。実装書01で作成)

```ts
export interface InventoryItem {
  pageId: string;                 // NotionページID
  name: string;                   // 品名
  inStock: boolean;               // 在庫あり=true / 在庫切れ=false
  category: string | null;        // カテゴリ(Select名)
  photoUrl: string | null;        // 写真1枚目のURL(なければnull)
  stores: string[];               // 購入先(Multi-select名の配列)
  lastPurchasedAt: string | null; // 'YYYY-MM-DD'(Rollup由来)
}

export interface User {
  pageId: string;
  name: string;
  lineUserId: string;
  active: boolean;
}

export interface Purchase {
  pageId: string;
  itemPageId: string | null;
  purchasedAt: string | null; // 'YYYY-MM-DD'
  store: string | null;
}

/** LINEへ返すメッセージ(必要最小限の自前型) */
export type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: Record<string, unknown> };

/** LINE Webhookイベント(必要フィールドのみの自前型) */
export interface LineWebhookEvent {
  type: string;
  replyToken?: string;
  source: { userId?: string };
  message?: { id: string; type: string; text?: string };
  postback?: { data: string };
}

/** 会話セッション状態 */
export type SessionState =
  | { flow: 'new'; step: 'name' }
  | { flow: 'edit'; step: 'name' | 'stores'; data: { pageId: string } }
  | { flow: 'attach_photo'; step: 'wait'; data: { pageId: string } };

/** ルーター/ハンドラ共通のコンテキスト */
export interface CommandContext {
  lineUserId: string;
}
```

### 5.2 サービス層シグネチャ

```ts
InventoryService.list(): InventoryItem[]                    // カテゴリ→品名順
InventoryService.listShortage(): InventoryItem[]            // inStock=false のみ
InventoryService.search(keyword: string): InventoryItem[]   // 品名部分一致
InventoryService.findByName(name: string): InventoryItem | null // 品名完全一致
InventoryService.getByPageId(pageId: string): InventoryItem | null
InventoryService.create(input: { name: string; category?: string; stores?: string[] }): InventoryItem // inStock=true で作成
InventoryService.setInStock(pageId: string, inStock: boolean): void
InventoryService.updateName(pageId: string, newName: string): void
InventoryService.updateStores(pageId: string, stores: string[]): void  // 全置換
InventoryService.attachPhoto(pageId: string, fileUploadId: string, filename: string): void

PurchaseService.record(item: InventoryItem, userPageId: string | null): void
PurchaseService.listRecent(itemPageId: string, limit?: number): Purchase[] // 購入日降順

UserService.register(lineUserId: string): User          // 新規登録 or 再有効化
UserService.deactivate(lineUserId: string): void
UserService.listActive(): User[]
UserService.findByLineUserId(lineUserId: string): User | null

NotificationService.notifyOutOfStock(item: InventoryItem, reporterLineUserId: string | null): void
```

### 5.3 クライアント層シグネチャ

```ts
LineClient.reply(replyToken: string, messages: LineMessage[]): void   // 最大5件
LineClient.push(userId: string, messages: LineMessage[]): void
LineClient.multicast(userIds: string[], messages: LineMessage[]): void
LineClient.getProfile(userId: string): { displayName: string; userId: string }
LineClient.getMessageContent(messageId: string): GoogleAppsScript.Base.Blob

NotionClient.queryDatabase(databaseId: string, payload: object): NotionQueryResponse
NotionClient.queryAll(databaseId: string, payload?: object): NotionPage[] // pagination吸収
NotionClient.createPage(payload: object): NotionPage
NotionClient.updatePage(pageId: string, payload: object): NotionPage
NotionClient.retrievePage(pageId: string): NotionPage
NotionClient.uploadFile(blob: GoogleAppsScript.Base.Blob, filename: string): string // fileUploadId
```

`NotionPage` / `NotionQueryResponse` はNotion APIレスポンスの必要最小限の自前型(実装書04で `src/clients/notionClient.ts` に定義しexport)。

### 5.4 セッション(ステップ入力)

```ts
SessionStore.get(userId: string): SessionState | null
SessionStore.set(userId: string, state: SessionState): void  // TTL 300秒
SessionStore.clear(userId: string): void
```

### 5.5 postback data 形式

クエリ文字列形式で統一: `action=<action>&step=<step>&id=<pageId>&...`
アクション一覧は実装書11の表を正とする。

## 6. 完了条件(Definition of Done)

- 各実装書の「受け入れ基準」を満たす。
- `npm run typecheck` と `npm run build` がエラーなく通り、`npm run push` でGASに反映できる。
- コードベースに `var` が存在しない(`grep -rn "var " src/` が0件。文字列内は除く)。
- 実装書15のE2Eチェックリストが全項目パスする。

## 7. リスク・注意点

| リスク | 対策 |
| --- | --- |
| clasp 3.x にTS変換がない | esbuildバンドル方式(§2.1)。実装書01でビルドが通ることを最初に確認する |
| esbuildバンドルでGASから関数が見えない | `src/index.ts` で `global` に束縛した関数のみ公開される。doPost等の露出漏れに注意 |
| LINE Webhookは数秒でタイムアウト | 返信はreply優先。通知pushはreply後に実行。重い処理を入れない |
| replyTokenは1回限り・有効期限が短い | 1イベントにつきreplyは1回だけ。追加連絡はpush |
| Notion APIレート制限(約3req/s) | queryAllは必要時のみ。通知はmulticastでLINE側1回に |
| GASのCacheServiceは最大100KB/キー、揮発性 | セッションは小さなJSONのみ。消えても再操作で復帰できる設計に |
| Notion File Uploadは20MB制限(single_part) | LINE画像は通常数MBなので単一パートで足りる。超過時はエラーメッセージ返信 |
| 同名品目の重複 | findByNameは完全一致。複数ヒット時は先頭を使い警告ログ。新規登録時は重複チェックして拒否 |
