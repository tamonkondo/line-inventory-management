# プロジェクト フォルダ構成案

- **作成日**: 2026-07-10
- **ステータス**: ドラフト（実装開始前のたたき台）
- **対象**: GAS（Google Apps Script）＋ clasp によるローカル開発を想定

> Notion の DB 構成は未確定のため、本書では **DBの数・スキーマに依存しないフォルダ構成** を示す。DB仕様が固まったら `services/` 配下や設定に反映する。

---

## 1. 前提と方針

- **開発スタイル**: ローカルでコードを書き、[clasp](https://github.com/google/clasp)（GAS CLI）で GAS プロジェクトへ push する。
- **GAS特有の注意**:
  - GAS は `.gs`（≒ `.js`）ファイルが**すべて同一のグローバルスコープ**を共有する。`import` / `require` は使えない。
  - よってフォルダ分け（`handlers/`, `services/` 等）は**あくまで人間の整理用**であり、関数・定数はファイルを跨いでグローバルに参照される。命名の衝突に注意する（プレフィックスや名前空間オブジェクトで回避）。
  - clasp はローカルのフォルダ階層を保持して push でき、GAS エディタ上では `handlers/messageHandler` のような名前で表示される。
- **関心の分離**: 「入口（エントリ）→ ルーティング → サービス（業務ロジック）→ 外部APIクライアント」の層に分ける。DBやAPIの詳細は下位層に閉じ込め、上位層から差し替えやすくする。

---

## 2. フォルダ構成（全体像）

```
line-inventory-management/
├── README.md                   # プロジェクト概要・セットアップ手順
├── .gitignore
├── .clasp.json                 # clasp設定（scriptId等。※機密はコミットしない）
├── .claspignore                # push対象から除外するファイル
├── appsscript.json             # GASマニフェスト（タイムゾーン・権限スコープ等）
├── package.json                # clasp等の開発ツール（任意）
│
├── docs/                       # ドキュメント類
│   ├── requirements.md         # 要件定義書（作成済み）
│   ├── folder-structure.md     # 本書
│   └── notion-schema.md        # DB設計書（※後日作成）
│
├── src/                        # GASにpushするソース一式
│   ├── main.js                 # エントリポイント（doPost / doGet）
│   ├── config.js               # 定数・設定値・スクリプトプロパティ読込
│   │
│   ├── handlers/               # LINE Webhookイベント種別ごとの処理
│   │   ├── messageHandler.js   #   テキストメッセージ受信
│   │   ├── postbackHandler.js  #   リッチメニュー/ボタンのpostback
│   │   └── followHandler.js    #   友だち追加/ブロック(follow/unfollow)
│   │
│   ├── router/                 # 入力の振り分け
│   │   └── commandRouter.js    #   コマンド文字列のパース＆ルーティング
│   │
│   ├── services/               # 業務ロジック（Notion DBに直接依存する層）
│   │   ├── inventoryService.js #   在庫のCRUD・不足判定
│   │   ├── userService.js      #   ユーザー登録・無効化
│   │   └── notificationService.js # 不足の即時通知の組み立て・配信
│   │
│   ├── clients/                # 外部APIの薄いラッパー
│   │   ├── lineClient.js       #   LINE Messaging API（reply/push）
│   │   └── notionClient.js     #   Notion API（query/create/update）
│   │
│   ├── messages/               # 返信メッセージの組み立て
│   │   └── flexBuilder.js      #   Flex Message（在庫カード等）生成
│   │
│   └── utils/                  # 汎用ユーティリティ
│       ├── signature.js        #   LINE署名(X-Line-Signature)検証
│       ├── parse.js            #   「追加 洗剤 2」等の引数パース
│       └── logger.js           #   ログ出力ラッパー
│
└── assets/                     # コード以外の素材（pushしない）
    └── richmenu/               # リッチメニュー定義・画像
        ├── richmenu.json       #   メニュー領域(tap area)定義
        └── richmenu.png        #   メニュー画像(2500x1686等)
```

> `services/` の中身は Notion のDB構成が固まってから具体化する。DBが増減しても、変更範囲を `services/` と `config.js` に閉じ込められる構成にしている。

---

## 3. レイヤの責務

| レイヤ | フォルダ | 責務 | 下位への依存 |
| --- | --- | --- | --- |
| エントリ | `main.js` | Webhook受信、署名検証、イベント振り分け | handlers |
| ハンドラ | `handlers/` | イベント種別ごとの入口処理 | router / services |
| ルーター | `router/` | コマンド解釈と対応サービスへの振り分け | services |
| サービス | `services/` | 在庫・ユーザー・通知の業務ロジック | clients / messages |
| クライアント | `clients/` | LINE / Notion API の呼び出しラッパー | utils |
| 表示 | `messages/` | Flex/テキストメッセージの生成 | utils |
| 共通 | `utils/` | 署名検証・パース・ログ等 | （なし） |

**依存の向きは上→下の一方向**を原則とする（下位が上位を参照しない）。

---

## 4. 処理フロー（概略）

```
LINE ──POST──▶ main.doPost
                 │  1. 署名検証 (utils/signature)
                 │  2. イベント種別を判定
                 ├─ message  ─▶ handlers/messageHandler ─▶ router/commandRouter ─▶ services/* ─▶ clients/lineClient (reply)
                 ├─ postback ─▶ handlers/postbackHandler ─▶ services/*            ─▶ clients/lineClient (reply)
                 └─ follow   ─▶ handlers/followHandler   ─▶ services/userService  ─▶ clients/notionClient

在庫を減らす操作 ─▶ services/inventoryService（しきい値判定）
                     └─ 不足なら ─▶ services/notificationService ─▶ clients/lineClient (push=全ユーザー)
```

---

## 5. サンプルファイル（スケルトン）

> 中身は雛形イメージ。実装時に肉付けする。関数はグローバル定義（GAS仕様）。

### `src/main.js`

```javascript
/** LINE Webhook 受信エントリポイント */
function doPost(e) {
  try {
    // 1. 署名検証
    if (!verifySignature(e)) {
      return ContentService.createTextOutput('invalid signature');
    }
    const body = JSON.parse(e.postData.contents);

    // 2. イベントごとに振り分け
    (body.events || []).forEach(function (event) {
      switch (event.type) {
        case 'message':  handleMessage(event);  break;
        case 'postback': handlePostback(event); break;
        case 'follow':   handleFollow(event);   break;
        case 'unfollow': handleUnfollow(event); break;
        default: /* no-op */ break;
      }
    });
    return ContentService.createTextOutput('OK');
  } catch (err) {
    logError('doPost', err);
    return ContentService.createTextOutput('error');
  }
}

/** 動作確認用（ブラウザアクセス） */
function doGet() {
  return ContentService.createTextOutput('LINE Inventory Bot is running.');
}
```

### `src/config.js`

```javascript
/** スクリプトプロパティから機密値・設定値を読む（コード直書き禁止） */
var CONFIG = {
  get LINE_CHANNEL_ACCESS_TOKEN() { return prop_('LINE_CHANNEL_ACCESS_TOKEN'); },
  get LINE_CHANNEL_SECRET()       { return prop_('LINE_CHANNEL_SECRET'); },
  get NOTION_TOKEN()              { return prop_('NOTION_TOKEN'); },
  // DB構成は後日確定。IDは増減しうるのでここに集約する
  get NOTION_INVENTORY_DB_ID()    { return prop_('NOTION_INVENTORY_DB_ID'); },
  get NOTION_USERS_DB_ID()        { return prop_('NOTION_USERS_DB_ID'); }
};

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}
```

### `src/clients/notionClient.js`

```javascript
/** Notion API 薄いラッパー（DB仕様に依存しない汎用I/F） */
var NotionClient = {
  queryDatabase: function (databaseId, payload) {
    return notionFetch_('POST', '/databases/' + databaseId + '/query', payload);
  },
  createPage: function (payload) {
    return notionFetch_('POST', '/pages', payload);
  },
  updatePage: function (pageId, payload) {
    return notionFetch_('PATCH', '/pages/' + pageId, payload);
  }
};

function notionFetch_(method, path, payload) {
  var res = UrlFetchApp.fetch('https://api.notion.com/v1' + path, {
    method: method,
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.NOTION_TOKEN,
      'Notion-Version': '2022-06-28'
    },
    payload: payload ? JSON.stringify(payload) : null,
    muteHttpExceptions: true
  });
  return JSON.parse(res.getContentText());
}
```

### `src/services/inventoryService.js`

```javascript
/** 在庫の業務ロジック（DBスキーマ確定後に肉付け） */
var InventoryService = {
  // 在庫一覧
  list: function (category) { /* TODO: NotionClient.queryDatabase(...) */ },
  // 追加/加算
  add: function (name, amount, unit) { /* TODO */ },
  // 消費/減算 → しきい値以下なら通知サービスへ
  consume: function (name, amount) { /* TODO */ },
  // 不足一覧
  listShortage: function () { /* TODO */ }
};
```

### `appsscript.json`（マニフェスト例）

```json
{
  "timeZone": "Asia/Tokyo",
  "dependencies": {},
  "webapp": {
    "access": "ANYONE_ANONYMOUS",
    "executeAs": "USER_DEPLOYING"
  },
  "exceptionLogging": "STACKDRIVER",
  "runtimeVersion": "V8"
}
```

### `.claspignore`（push除外例）

```
**/**
!src/**
!appsscript.json
```

---

## 6. 機密情報・Gitの扱い

- **コミットしないもの**（`.gitignore` 対象）:
  - `.clasp.json`（scriptId が入る。共有リポジトリでは特に注意）
  - トークン類は**そもそもコードに書かず** GAS の「スクリプトプロパティ」で管理
- LINE / Notion のトークンは、GAS エディタの「プロジェクトの設定 → スクリプトプロパティ」に登録し、`config.js` 経由で参照する。

---

## 7. 未確定・後日反映する箇所

| 箇所 | 内容 | 反映タイミング |
| --- | --- | --- |
| `services/` の実装 | Notion DBのプロパティ名・型に合わせたCRUD | DB設計確定後 |
| `config.js` のDB ID群 | DBの数・種類に応じて増減 | DB作成後 |
| `docs/notion-schema.md` | DB設計書 | 別途作成 |
| `assets/richmenu/` | リッチメニュー画像・領域定義 | UI設計時 |

> 本構成は DB の数・構成が変わっても、影響を `config.js` と `services/` に限定できるよう設計している。
