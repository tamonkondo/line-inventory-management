# 実装書(02): Webhookエントリ — 署名検証・main.js

- **依存**: 01
- **対象ファイル**: `src/utils/signature.js`(実装)、`src/main.js`(微修正)

## 目的

LINEからのWebhookリクエストの署名(X-Line-Signature)を検証し、不正リクエストを弾く。

## 1. `src/utils/signature.js` の実装

LINEの署名検証仕様: リクエストボディ(生文字列)をチャネルシークレットでHMAC-SHA256署名し、Base64エンコードした値が `X-Line-Signature` ヘッダと一致すること。

```js
/** LINE Webhook の X-Line-Signature を検証する。 */
function verifySignature(e) {
  if (!e || !e.postData || !e.postData.contents) return false;

  // GASのdoPostはHTTPヘッダを直接取得できないため、
  // Webhook URLのクエリパラメータ経由は使わず、parameterからも取れない。
  // → GASの制約上、X-Line-Signatureヘッダは e.parameter では取得不可。
  //   そのため検証は「チャネルシークレットによるHMAC計算が可能な範囲」で行う。
  //   実運用では以下の2段構えとする:
  //   (1) Webhook URLを秘匿(推測不能なGASデプロイURL)
  //   (2) ボディ構造の妥当性検証(destination / events フィールドの存在)
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return false;
  }
  return typeof body === 'object' && body !== null && Array.isArray(body.events);
}
```

> **重要な制約**: GASの `doPost(e)` ではHTTPリクエストヘッダを読めないため、
> X-Line-Signature の完全な検証は**不可能**。上記のように構造検証+URL秘匿で代替する。
> この制約と代替策を `verifySignature` のコメントに明記すること。
> (将来Cloud Functions等へ移行する場合はHMAC検証を復活させる)

HMAC計算自体のユーティリティは将来の移行に備えて実装しておく:

```js
/** 参考実装: bodyのHMAC-SHA256をBase64で返す(ヘッダが取れる環境への移行用) */
function computeLineSignature_(bodyText) {
  var raw = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(bodyText).getBytes(),
    Utilities.newBlob(CONFIG.LINE_CHANNEL_SECRET).getBytes()
  );
  return Utilities.base64Encode(raw);
}
```

## 2. `src/main.js` の修正

既存の構造は維持し、以下のみ変更する。

1. `case 'message'` の分岐で、画像メッセージをテキストと区別できるよう `handleMessage(event)` に一本化したまま(振り分けは `messageHandler` 側の責務、実装書11)。**main.jsの変更は最小限にする。**
2. 各イベント処理を個別に try-catch し、1イベントの失敗が他イベントの処理を止めないようにする:

```js
(body.events || []).forEach(function (event) {
  try {
    switch (event.type) {
      case 'message':  handleMessage(event);  break;
      case 'postback': handlePostback(event); break;
      case 'follow':   handleFollow(event);   break;
      case 'unfollow': handleUnfollow(event); break;
      default: /* no-op */ break;
    }
  } catch (err) {
    logError('doPost:event:' + event.type, err);
  }
});
```

3. 冒頭で `logInfo('doPost', 'events=' + (body.events || []).length);` を出す(本文全体はログに出さない — ユーザー発言のプライバシーとログ肥大防止)。

## 3. 受け入れ基準

- [ ] `verifySignature` が「postDataなし」「JSONでない」「eventsが配列でない」入力で `false` を返す。
- [ ] 正常なWebhookボディ(`{"destination":"xxx","events":[]}`)で `true` を返す。
- [ ] `computeLineSignature_` が定義されている(未使用でよい)。
- [ ] main.jsで1イベントの例外が他のイベント処理を止めない。
- [ ] GASの制約(ヘッダ取得不可)がコメントで説明されている。

## 4. 動作確認方法

```js
function test_signature() {
  var ok = verifySignature({ postData: { contents: '{"events":[]}' } });
  var ng1 = verifySignature({});
  var ng2 = verifySignature({ postData: { contents: 'not-json' } });
  logInfo('test', { ok: ok, ng1: ng1, ng2: ng2 }); // → {ok:true, ng1:false, ng2:false}
}
```

デプロイ後、`curl -X POST <WebアプリURL> -H 'Content-Type: application/json' -d '{"events":[]}'` が `OK` を返すこと。
