# 実装書(03): LINE Messaging API クライアント

- **依存**: 01
- **対象ファイル**: `src/clients/lineClient.js`(実装)

## 目的

LINE Messaging API の薄いラッパーを実装する。業務ロジックは持たない。

## 1. 実装内容

ベースURL: `https://api.line.me/v2/bot`
認証ヘッダ: `Authorization: Bearer <CONFIG.LINE_CHANNEL_ACCESS_TOKEN>`

```js
/** LINE Messaging API の薄いラッパー。 */
var LineClient = {
  /** 応答メッセージ。messages は最大5件の配列 */
  reply: function (replyToken, messages) {
    return lineFetch_('POST', '/message/reply', {
      replyToken: replyToken,
      messages: messages
    });
  },

  /** 1ユーザーへのプッシュ */
  push: function (userId, messages) {
    return lineFetch_('POST', '/message/push', {
      to: userId,
      messages: messages
    });
  },

  /** 複数ユーザーへの一斉送信(最大500 userId) */
  multicast: function (userIds, messages) {
    if (!userIds || userIds.length === 0) return null;
    return lineFetch_('POST', '/message/multicast', {
      to: userIds,
      messages: messages
    });
  },

  /** プロフィール取得 → {displayName, userId, pictureUrl?, statusMessage?} */
  getProfile: function (userId) {
    return lineFetch_('GET', '/profile/' + userId, null);
  },

  /** 画像等のコンテンツ取得 → Blob。※ホストが api-data.line.me な点に注意 */
  getMessageContent: function (messageId) {
    var res = UrlFetchApp.fetch(
      'https://api-data.line.me/v2/bot/message/' + messageId + '/content',
      {
        method: 'get',
        headers: { Authorization: 'Bearer ' + CONFIG.LINE_CHANNEL_ACCESS_TOKEN },
        muteHttpExceptions: true
      }
    );
    if (res.getResponseCode() !== 200) {
      throw new Error('LINE content fetch failed: ' + res.getResponseCode());
    }
    return res.getBlob();
  }
};

/** 共通fetch。2xx以外はエラーログを出して例外を投げる */
function lineFetch_(method, path, payload) {
  var options = {
    method: method.toLowerCase(),
    headers: { Authorization: 'Bearer ' + CONFIG.LINE_CHANNEL_ACCESS_TOKEN },
    muteHttpExceptions: true
  };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  var res = UrlFetchApp.fetch('https://api.line.me/v2/bot' + path, options);
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    logError('LineClient', method + ' ' + path + ' → ' + code + ' ' + res.getContentText());
    throw new Error('LINE API error: ' + code);
  }
  var text = res.getContentText();
  return text ? JSON.parse(text) : null;
}
```

## 2. 注意点

- `reply` の messages は**配列**で受ける(呼び出し側が単一メッセージでも `[msg]` で渡す)。
- replyTokenは1回しか使えない。リトライ実装は入れない(失敗したらログのみ)。
- `getMessageContent` のホストは `api-data.line.me`(通常APIと異なる)。
- multicast は自分(送信元Bot)を含められない・userIdは最大500件。今回の規模では分割不要だが、空配列なら何もせず `null` を返す。
- リッチメニュー系APIは実装書14の `richMenuSetup.js` 側に置く(このファイルには追加しない)。

## 3. 受け入れ基準

- [ ] 上記5メソッドが実装されている。
- [ ] 2xx以外のレスポンスで `logError` が呼ばれ、例外が投がる。
- [ ] トークンがログに出力されない。
- [ ] `multicast([], msgs)` が API を呼ばずに `null` を返す。

## 4. 動作確認方法

スクリプトプロパティ `LINE_CHANNEL_ACCESS_TOKEN` 設定後、GASエディタで:

```js
function test_linePush() {
  // 自分のuserId(Webhookのログ等で確認)に対して送る
  LineClient.push('U自分のuserId', [{ type: 'text', text: 'テスト送信' }]);
}
```

LINEに「テスト送信」が届けばOK。`getProfile` も同じuserIdで表示名が取れることを確認。
