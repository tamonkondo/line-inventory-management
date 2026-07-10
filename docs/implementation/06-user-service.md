# 実装書(06): ユーザー管理 — userService・follow/unfollowハンドラ

- **依存**: 03, 04, 05
- **対象ファイル**: `src/services/userService.js`(実装)、`src/handlers/followHandler.js`(実装)

## 目的

友だち追加で自動登録(F-13)、ブロックで無効化(F-15)、通知対象の有効ユーザー一覧(F-11)を実装する。

## 1. `src/services/userService.js`

```js
var UserService = {
  /** lineUserIdで1件検索 → User|null */
  findByLineUserId: function (lineUserId) {
    var res = NotionClient.queryDatabase(CONFIG.NOTION_USERS_DB_ID, {
      filter: {
        property: NOTION_PROPS.USERS.LINE_USER_ID,
        rich_text: { equals: lineUserId }
      },
      page_size: 1
    });
    var page = (res.results || [])[0];
    return page ? NotionMapper.toUser(page) : null;
  },

  /** 登録 or 再有効化 → User */
  register: function (lineUserId) { ... },

  /** 無効化(未登録なら何もしない) */
  deactivate: function (lineUserId) { ... },

  /** 有効ユーザー一覧 → User[] */
  listActive: function () {
    var pages = NotionClient.queryAll(CONFIG.NOTION_USERS_DB_ID, {
      filter: {
        property: NOTION_PROPS.USERS.STATUS,
        select: { equals: USER_STATUS.ACTIVE }
      }
    });
    return pages.map(NotionMapper.toUser);
  }
};
```

### 1.1 `register(lineUserId)` の詳細手順

1. `findByLineUserId` で既存確認。
2. **既存あり** → ステータスを「有効」に更新(再フォロー対応)して返す。
3. **既存なし** →
   - `LineClient.getProfile(lineUserId)` で表示名を取得。失敗したら表示名は `'(不明)'` として続行(登録は止めない)。
   - ユーザーDBへページ作成:
     ```js
     NotionClient.createPage({
       parent: { database_id: CONFIG.NOTION_USERS_DB_ID },
       properties: {
         [表示名]: { title: [{ text: { content: displayName } }] },
         [LINE User ID]: { rich_text: [{ text: { content: lineUserId } }] },
         [ステータス]: { select: { name: USER_STATUS.ACTIVE } },
         [登録日]: { date: { start: todayStr_() } }  // 'YYYY-MM-DD'(Asia/Tokyo)
       }
     });
     ```
   - `todayStr_()` は `Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd')`。
4. 作成/更新後の User オブジェクトを返す。

※ プロパティ名は `NOTION_PROPS.USERS.*` を使うこと。V8では computed property name(`[NOTION_PROPS.USERS.NAME]: ...`)が使える。

### 1.2 `deactivate(lineUserId)` の詳細手順

1. `findByLineUserId` で検索。なければ `logInfo` して終了。
2. あればステータスを「無効」に `updatePage`。

## 2. `src/handlers/followHandler.js`

```js
/** 友だち追加イベントを処理する。 */
function handleFollow(event) {
  var userId = event.source.userId;
  var user = UserService.register(userId);
  LineClient.reply(event.replyToken, [{
    type: 'text',
    text: user.name + 'さん、追加ありがとうございます!\n' +
          '家庭の在庫をみんなで管理するBotです。\n\n' +
          '下のメニューから操作できます。\n' +
          '・在庫一覧 / 不足一覧\n' +
          '・なくなった / 買った の報告\n' +
          '・新規登録\n\n' +
          '「ヘルプ」と送るとコマンド一覧が見られます。'
  }]);
}

/** ブロック(友だち解除)イベントを処理する。 */
function handleUnfollow(event) {
  UserService.deactivate(event.source.userId);
  // unfollowにreplyTokenはない。返信しない。
}
```

## 3. エッジケース

| ケース | 挙動 |
| --- | --- |
| 再フォロー(無効→有効) | registerが既存ページを有効化。ページは増やさない |
| getProfile失敗(ブロック直後等) | 表示名 '(不明)' で登録続行 |
| unfollowで未登録ユーザー | 何もしない(ログのみ) |
| グループトーク由来のイベント(userIdなし) | `event.source.userId` がなければ処理せずreturn |

## 4. 受け入れ基準

- [ ] follow → ユーザーDBに「有効」で1行増え、あいさつが返信される。
- [ ] 再follow → 行が増えず、ステータスが「有効」に戻る。
- [ ] unfollow → ステータスが「無効」になる。
- [ ] `listActive()` が「有効」のみ返す。
- [ ] userId のない source で例外にならない。

## 5. 動作確認方法

1. Notion ユーザーDB作成+プロパティ設定後、実機のLINEでBotをブロック→ブロック解除し、DBの行とステータス遷移を確認。
2. `test_listActive()` を作り、有効ユーザーの件数がDBの見た目と一致することを確認。
