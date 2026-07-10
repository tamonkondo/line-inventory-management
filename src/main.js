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
