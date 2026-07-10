# 実装書(13): 写真登録フロー — LINE画像 → Notion

- **依存**: 03, 04, 07, 11
- **対象ファイル**: `src/handlers/imageHandler.ts`(**新規作成**)

## 目的

ユーザーがLINEで送った画像を品目の「写真」プロパティに登録する(F-19 / R-03)。

## 1. フロー全体

```
ユーザーが画像送信
  → messageHandler(type==='image') → handleImageMessage(event)
    → SessionStore.get(userId)
       ├ flow==='attach_photo' →
       │   1. LineClient.getMessageContent(messageId) → Blob
       │   2. NotionClient.uploadFile(blob, filename) → fileUploadId
       │   3. InventoryService.attachPhoto(pageId, fileUploadId, filename)
       │   4. SessionStore.clear(userId)
       │   5. reply: 「(品名)に写真を登録しました 📷」
       └ セッションなし/他フロー →
           reply: 「写真を登録するには「編集 品名」→「写真を変える」から操作してください」
```

## 2. `src/handlers/imageHandler.ts` の実装

```ts
import { LineClient } from '../clients/lineClient';
import { NotionClient } from '../clients/notionClient';
import { InventoryService } from '../services/inventoryService';
import { SessionStore } from '../utils/sessionStore';
import { logError } from '../utils/logger';
import type { LineWebhookEvent } from '../types';

/** ContentTypeから拡張子を決めてファイル名を作る(非export) */
const buildPhotoFilename = (blob: GoogleAppsScript.Base.Blob): string => {
  const contentType = (blob.getContentType() ?? '').toLowerCase();
  const ext = contentType.includes('png') ? 'png' : 'jpg'; // LINEの画像は基本jpeg
  const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
  return `photo-${stamp}.${ext}`;
};

/** 画像メッセージを処理する(写真登録フロー: F-19)。 */
export const handleImageMessage = (event: LineWebhookEvent): void => {
  const userId = event.source.userId;
  if (!userId || !event.replyToken || !event.message) return;

  const session = SessionStore.get(userId);
  if (session?.flow !== 'attach_photo') {
    LineClient.reply(event.replyToken, [{
      type: 'text',
      text: '写真を登録するには「編集 品名」→「写真を変える」から操作してください。',
    }]);
    return;
  }

  const { pageId } = session.data;
  try {
    const blob = LineClient.getMessageContent(event.message.id);
    const filename = buildPhotoFilename(blob);
    const fileUploadId = NotionClient.uploadFile(blob, filename);
    InventoryService.attachPhoto(pageId, fileUploadId, filename);
    SessionStore.clear(userId);

    const item = InventoryService.getByPageId(pageId);
    LineClient.reply(event.replyToken, [{
      type: 'text',
      text: `${item?.name ?? '品目'} に写真を登録しました 📷`,
    }]);
  } catch (err) {
    logError('handleImageMessage', err);
    // セッションは維持(もう一度送れば再試行できる)
    LineClient.reply(event.replyToken, [{
      type: 'text',
      text: '写真の登録に失敗しました。もう一度送るか、「キャンセル」してください。',
    }]);
  }
};
```

## 3. 仕様メモ・制約

- 写真は**1品目1枚**運用。`attachPhoto` は既存filesを置き換える(実装書07)。
- LINEの画像コンテンツ取得はメッセージ受信後しばらくの間のみ有効。受信イベント内で即取得する(このフロー内で完結するため問題なし)。
- Notion File Upload(single_part)は20MB上限。LINEのトーク画像は圧縮されるため通常超えないが、`uploadFile` が例外を投げたら上記catchで謝る。
- 動画・スタンプは対象外(`message.type === 'image'` のみがここに来る。messageHandler側でフィルタ済み)。
- 一覧・カード表示側(実装書12)は `photoUrl`(Notionの署名付きURL)を使うため、本タスクの登録が成功すればそのまま表示に反映される。

## 4. 受け入れ基準

- [ ] 「編集 品名」→「写真を変える」→画像送信 で、Notionの品目ページに写真が付く。
- [ ] 新規登録直後の画像送信でも写真が付く(実装書11の `new` フロー経由)。
- [ ] セッションなしで画像を送ると案内文が返る(例外にならない)。
- [ ] 失敗時にセッションが残り、画像を再送すれば成功する。
- [ ] 写真登録後の「在庫」一覧・品目カードにサムネイルが表示される。
- [ ] `npm run typecheck` が通る。

## 5. 動作確認方法

実機で上記フローを実行し、Notion画面で「写真」プロパティにファイルが入ること、LINEの品目カードに画像が出ることを確認する。
