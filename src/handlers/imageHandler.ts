import { LineClient } from '../clients/lineClient';
import { NotionClient } from '../clients/notionClient';
import { InventoryService } from '../services/inventoryService';
import { textMessage } from '../messages/flexBuilder';
import { SessionStore } from '../utils/sessionStore';
import { logError } from '../utils/logger';
import type { LineWebhookEvent } from '../types';

/** ContentTypeから拡張子を決めてファイル名を作る */
const buildPhotoFilename = (blob: GoogleAppsScript.Base.Blob): string => {
  const contentType = (blob.getContentType() ?? '').toLowerCase();
  const ext = contentType.includes('png') ? 'png' : 'jpg'; // LINEの画像は基本jpeg
  const stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
  return `photo-${stamp}.${ext}`;
};

/**
 * 画像メッセージを処理する(写真登録フロー: F-19)。
 * attach_photoセッション中のみ登録し、それ以外は操作方法を案内する。
 */
export const handleImageMessage = (event: LineWebhookEvent): void => {
  const userId = event.source.userId;
  if (!userId || !event.replyToken || !event.message) return;

  const session = SessionStore.get(userId);
  if (session?.flow !== 'attach_photo') {
    LineClient.reply(event.replyToken, [
      textMessage('写真を登録するには「編集 品名」→「写真を変える」から操作してください。'),
    ]);
    return;
  }

  const { pageId } = session.data;
  try {
    // LINEの画像コンテンツは受信後しばらくしか取得できないため、このイベント内で即取得する
    const blob = LineClient.getMessageContent(event.message.id);
    const filename = buildPhotoFilename(blob);
    const fileUploadId = NotionClient.uploadFile(blob, filename);
    InventoryService.attachPhoto(pageId, fileUploadId, filename);
  } catch (err) {
    logError('handleImageMessage', err);
    // セッションは維持: もう一度画像を送れば再試行できる
    LineClient.reply(event.replyToken, [
      textMessage('写真の登録に失敗しました。もう一度送るか、「キャンセル」してください。'),
    ]);
    return;
  }

  // ここから先は登録成功後の後処理: 失敗扱いにしない(「失敗しました」と偽らない)
  SessionStore.clear(userId);
  const item = InventoryService.getByPageId(pageId); // 取得失敗はnull(名前なしで続行)
  LineClient.reply(event.replyToken, [
    textMessage(`${item?.name ?? '品目'} に写真を登録しました 📷`),
  ]);
};
