# 実装計画書(00): 全体計画

- **対象**: LINE × Notion 在庫管理 Bot(GAS)の初期実装
- **根拠ドキュメント**: `docs/requirements.md`(v1.0 + v1.1 / R-08 boolean管理)、`docs/notion-schema.md`
- **作成日**: 2026-07-10

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

- ランタイム: Google Apps Script(V8)。`clasp push` で `src/` 配下を反映(`.claspignore` 参照)。
- **ES Modules(`import`/`export`)は使用禁止**。GASは全ファイルがグローバルスコープを共有する。
  - 名前空間オブジェクト方式: `var InventoryService = { ... }`
  - グローバル関数方式: `function handleMessage(event) { ... }`(Webhookエントリ・ハンドラ)
  - ファイル内プライベート関数は末尾 `_` を付ける: `function notionFetch_() {}`
- 既存の雛形ファイルのシグネチャ・コメントスタイルを踏襲する。
- 機密値・設定値はすべて `CONFIG`(スクリプトプロパティ)経由。**コード直書き禁止**。
- Notion のプロパティ名は `src/config.js` の定数 `NOTION_PROPS` に集約し、サービス層はそれを参照する(タイポ・変更に強くする)。
- 外部API呼び出しは `UrlFetchApp.fetch` + `muteHttpExceptions: true` とし、ステータスコードを必ず確認する。
- ログは `logInfo` / `logError` を必ず経由する(`console.log` 直書き禁止)。

## 3. アーキテクチャとファイル構成

```
LINE → doPost(main.js) → 署名検証(utils/signature.js)
     → イベント振り分け
         message  → handlers/messageHandler.js ─┬→ セッション継続(utils/sessionStore.js)
         postback → handlers/postbackHandler.js ─┤
         follow   → handlers/followHandler.js    │
     → router/commandRouter.js(テキストコマンド)│
     → services/*(業務ロジック)◀───────────────┘
         inventoryService / purchaseService / userService / notificationService
     → clients/*(外部API)
         lineClient(LINE Messaging API) / notionClient(Notion API)
     → messages/flexBuilder.js(表示組み立て)
```

| ファイル | 状態 | 担当実装書 |
| --- | --- | --- |
| `src/config.js` | 拡張 | 01 |
| `src/utils/logger.js` | 実装 | 01 |
| `src/utils/signature.js` | 実装 | 02 |
| `src/main.js` | 微修正 | 02 |
| `src/clients/lineClient.js` | 実装 | 03 |
| `src/clients/notionClient.js` | 拡張 | 04 |
| `src/utils/notionMapper.js` | **新規** | 05 |
| `src/services/userService.js` | 実装 | 06 |
| `src/handlers/followHandler.js` | 実装 | 06 |
| `src/services/inventoryService.js` | **書き換え**(boolean化) | 07 |
| `src/services/purchaseService.js` | **新規** | 08 |
| `src/services/notificationService.js` | 実装 | 09 |
| `src/utils/parse.js` | 実装 | 10 |
| `src/router/commandRouter.js` | 実装 | 10 |
| `src/utils/sessionStore.js` | **新規** | 11 |
| `src/handlers/postbackHandler.js` | 実装 | 11 |
| `src/handlers/messageHandler.js` | 実装 | 11 |
| `src/messages/flexBuilder.js` | 実装 | 12 |
| `src/handlers/imageHandler.js` | **新規** | 13 |
| `assets/richmenu/richmenu.json` | 実装 | 14 |
| `src/setup/richMenuSetup.js` | **新規** | 14 |
| (手順書・E2Eチェックリスト) | - | 15 |

## 4. タスク一覧と依存関係

| # | 実装書 | 内容 | 依存 |
| --- | --- | --- | --- |
| 01 | `01-foundation.md` | config拡張・NOTION_PROPS定数・logger | なし |
| 02 | `02-webhook-entry.md` | 署名検証・main.js | 01 |
| 03 | `03-line-client.md` | LINE APIクライアント | 01 |
| 04 | `04-notion-client.md` | Notion APIクライアント(汎用+File Upload) | 01 |
| 05 | `05-notion-mapper.md` | Notionページ⇔ドメインオブジェクト変換 | 01 |
| 06 | `06-user-service.md` | ユーザー登録・無効化・follow/unfollow | 03, 04, 05 |
| 07 | `07-inventory-service.md` | 在庫サービス(boolean管理) | 04, 05 |
| 08 | `08-purchase-service.md` | 購入履歴サービス | 04, 05, 07 |
| 09 | `09-notification-service.md` | 在庫切れ通知 | 03, 06 |
| 10 | `10-command-router.md` | コマンドパーサー・ルーター | 07, 08, 09, 12 |
| 11 | `11-conversation-flows.md` | セッション管理・postback/messageハンドラ | 07, 08, 09, 10, 12 |
| 12 | `12-flex-builder.md` | Flexメッセージ組み立て | 05(ドメイン型のみ) |
| 13 | `13-photo-upload.md` | 写真登録(LINE画像→Notion) | 03, 04, 07, 11 |
| 14 | `14-rich-menu.md` | リッチメニュー定義・登録スクリプト | 03 |
| 15 | `15-setup-e2e.md` | Notion DB作成・デプロイ・E2E検証 | 全部 |

**推奨実装順**: 01 → (02, 03, 04, 05 は並行可) → (06, 07, 12 は並行可) → 08, 09 → 10 → 11 → 13, 14 → 15

## 5. 共有インターフェース(全実装書共通の契約)

タスクを並行実装しても噛み合うよう、境界となる型と関数シグネチャをここで確定する。
**各実装書はこの契約に従うこと。変更したくなった場合はこの計画書を先に更新する。**

### 5.1 ドメインオブジェクト

```js
// InventoryItem(notionMapper が生成、services/messages が消費)
{
  pageId: string,            // NotionページID
  name: string,              // 品名
  inStock: boolean,          // 在庫あり=true / 在庫切れ=false
  category: string|null,     // カテゴリ(Select名)
  photoUrl: string|null,     // 写真1枚目のURL(なければnull)
  stores: string[],          // 購入先(Multi-select名の配列)
  location: string|null,     // 保管場所
  expiryDate: string|null,   // 'YYYY-MM-DD'
  lastPurchasedAt: string|null // 'YYYY-MM-DD'(Rollup由来)
}

// User
{ pageId: string, name: string, lineUserId: string, active: boolean }

// Purchase
{ pageId: string, itemPageId: string|null, purchasedAt: string|null, store: string|null }
```

### 5.2 サービス層シグネチャ

```js
InventoryService.list()                       // → InventoryItem[](カテゴリ→品名順)
InventoryService.listShortage()               // → InventoryItem[](inStock=false のみ)
InventoryService.search(keyword)              // → InventoryItem[](品名部分一致)
InventoryService.findByName(name)             // → InventoryItem|null(品名完全一致)
InventoryService.getByPageId(pageId)          // → InventoryItem|null
InventoryService.create({name, category, stores}) // → InventoryItem(inStock=true で作成)
InventoryService.setInStock(pageId, inStock)  // → void
InventoryService.updateName(pageId, newName)  // → void
InventoryService.updateStores(pageId, stores) // → void(全置換)
InventoryService.attachPhoto(pageId, fileUploadId, filename) // → void

PurchaseService.record(item, userPageIdOrNull) // → void(履歴1件作成)
PurchaseService.listRecent(itemPageId, limit)  // → Purchase[](購入日降順)

UserService.register(lineUserId)          // → User(新規登録 or 再有効化)
UserService.deactivate(lineUserId)        // → void
UserService.listActive()                  // → User[]
UserService.findByLineUserId(lineUserId)  // → User|null

NotificationService.notifyOutOfStock(item, reporterLineUserId) // → void
```

### 5.3 クライアント層シグネチャ

```js
LineClient.reply(replyToken, messages)        // messages: メッセージオブジェクト配列(最大5)
LineClient.push(userId, messages)
LineClient.multicast(userIds, messages)
LineClient.getProfile(userId)                 // → {displayName, userId, ...}
LineClient.getMessageContent(messageId)       // → Blob(画像バイナリ)

NotionClient.queryDatabase(databaseId, payload)     // → APIレスポンス(結果は results)
NotionClient.queryAll(databaseId, payload)          // → ページ配列(pagination吸収)
NotionClient.createPage(payload)
NotionClient.updatePage(pageId, payload)
NotionClient.retrievePage(pageId)
NotionClient.uploadFile(blob, filename)             // → fileUploadId(string)
```

### 5.4 セッション(ステップ入力)状態

```js
SessionStore.get(userId)          // → state|null
SessionStore.set(userId, state)   // TTL 300秒
SessionStore.clear(userId)
// state = { flow: 'new'|'edit'|'attach_photo', step: string, data: Object }
```

### 5.5 postback data 形式

クエリ文字列形式で統一: `action=<action>&step=<step>&id=<pageId>&...`
アクション一覧は実装書11の表を正とする。

## 6. 完了条件(Definition of Done)

- 各実装書の「受け入れ基準」を満たす。
- `clasp push` がエラーなく通る(構文エラーがない)。
- 実装書15のE2Eチェックリストが全項目パスする。

## 7. リスク・注意点

| リスク | 対策 |
| --- | --- |
| LINE Webhookは数秒でタイムアウト | 返信はreply優先。通知pushはreply後に実行。重い処理を入れない |
| replyTokenは1回限り・有効期限が短い | 1イベントにつきreplyは1回だけ。追加連絡はpush |
| Notion APIレート制限(約3req/s) | queryAllは必要時のみ。通知はmulticastでLINE側1回に |
| GASのCacheServiceは最大100KB/キー、揮発性 | セッションは小さなJSONのみ。消えても再操作で復帰できる設計に |
| Notion File Uploadは20MB制限(single_part) | LINE画像は通常数MBなので単一パートで足りる。超過時はエラーメッセージ返信 |
| 同名品目の重複 | findByNameは完全一致。複数ヒット時は先頭を使い警告ログ。新規登録時は重複チェックして拒否 |
