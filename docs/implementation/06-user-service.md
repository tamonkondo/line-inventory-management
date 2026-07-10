# 実装書(06): ユーザー管理 — userService・follow/unfollowハンドラ

- **依存**: 03, 04, 05
- **対象ファイル**: `src/services/userService.ts`(新規)、`src/handlers/followHandler.ts`(新規)。旧 `.js` 2ファイルを削除

## 目的

友だち追加で自動登録(F-13)、ブロックで無効化(F-15)、通知対象の有効ユーザー一覧(F-11)を実装する。

## 1. `src/services/userService.ts`

```ts
import { CONFIG, NOTION_PROPS, USER_STATUS } from '../config';
import { NotionClient } from '../clients/notionClient';
import { NotionMapper } from '../utils/notionMapper';
import { LineClient } from '../clients/lineClient';
import { logInfo } from '../utils/logger';
import type { User } from '../types';

const P = NOTION_PROPS.USERS;

const todayStr = (): string => Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

export const UserService = {
  /** lineUserIdで1件検索 */
  findByLineUserId(lineUserId: string): User | null {
    const res = NotionClient.queryDatabase(CONFIG.NOTION_USERS_DB_ID, {
      filter: { property: P.LINE_USER_ID, rich_text: { equals: lineUserId } },
      page_size: 1,
    });
    const page = res.results[0];
    return page ? NotionMapper.toUser(page) : null;
  },

  /** 登録 or 再有効化 */
  register(lineUserId: string): User { ... },

  /** 無効化(未登録なら何もしない) */
  deactivate(lineUserId: string): void { ... },

  /** 有効ユーザー一覧 */
  listActive(): User[] {
    const pages = NotionClient.queryAll(CONFIG.NOTION_USERS_DB_ID, {
      filter: { property: P.STATUS, select: { equals: USER_STATUS.ACTIVE } },
    });
    return pages.map((page) => NotionMapper.toUser(page));
  },
};
```

### 1.1 `register(lineUserId)` の詳細手順

1. `findByLineUserId` で既存確認。
2. **既存あり** → ステータスを「有効」に更新(再フォロー対応)し、`{ ...existing, active: true }` を返す。
3. **既存なし** →
   - `LineClient.getProfile(lineUserId)` で表示名を取得。**失敗したら表示名は `'(不明)'` として続行**(登録は止めない。try-catchで握る)。
   - ユーザーDBへページ作成:
     ```ts
     const page = NotionClient.createPage({
       parent: { database_id: CONFIG.NOTION_USERS_DB_ID },
       properties: {
         [P.NAME]: { title: [{ text: { content: displayName } }] },
         [P.LINE_USER_ID]: { rich_text: [{ text: { content: lineUserId } }] },
         [P.STATUS]: { select: { name: USER_STATUS.ACTIVE } },
         [P.REGISTERED_AT]: { date: { start: todayStr() } },
       },
     });
     return NotionMapper.toUser(page);
     ```

### 1.2 `deactivate(lineUserId)` の詳細手順

1. `findByLineUserId` で検索。なければ `logInfo` して終了。
2. あればステータスを「無効」に `updatePage`:
   ```ts
   NotionClient.updatePage(user.pageId, {
     properties: { [P.STATUS]: { select: { name: USER_STATUS.INACTIVE } } },
   });
   ```

## 2. `src/handlers/followHandler.ts`

```ts
import { UserService } from '../services/userService';
import { LineClient } from '../clients/lineClient';
import type { LineWebhookEvent } from '../types';

/** 友だち追加イベントを処理する。 */
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

/** ブロック(友だち解除)イベントを処理する。unfollowにreplyTokenはない。 */
export const handleUnfollow = (event: LineWebhookEvent): void => {
  const userId = event.source.userId;
  if (!userId) return;
  UserService.deactivate(userId);
};
```

## 3. エッジケース

| ケース | 挙動 |
| --- | --- |
| 再フォロー(無効→有効) | registerが既存ページを有効化。ページは増やさない |
| getProfile失敗(ブロック直後等) | 表示名 '(不明)' で登録続行 |
| unfollowで未登録ユーザー | 何もしない(ログのみ) |
| userIdのないsource(グループ等) | 処理せずreturn |

## 4. 受け入れ基準

- [ ] follow → ユーザーDBに「有効」で1行増え、あいさつが返信される。
- [ ] 再follow → 行が増えず、ステータスが「有効」に戻る。
- [ ] unfollow → ステータスが「無効」になる。
- [ ] `listActive()` が「有効」のみ返す。
- [ ] userIdのないsourceで例外にならない。
- [ ] `npm run typecheck` が通る。

## 5. 動作確認方法

1. Notion ユーザーDB作成+プロパティ設定後、実機のLINEでBotをブロック→ブロック解除し、DBの行とステータス遷移を確認。
2. `test_listActive` を一時作成し、有効ユーザーの件数がDBの見た目と一致することを確認。
