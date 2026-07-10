import { CONFIG } from '../config';

/**
 * LINE Webhookリクエストの妥当性を検証する。
 *
 * 本来はリクエストボディをチャネルシークレットでHMAC-SHA256署名した値と
 * X-Line-Signature ヘッダの一致を確認すべきだが、GASの doPost(e) では
 * HTTPリクエストヘッダを取得できないため、完全な署名検証は不可能。
 * 代替として以下の2段構えとする:
 *   (1) Webhook URLの秘匿(推測不能なGASデプロイURL)
 *   (2) ボディ構造の妥当性検証(eventsフィールドの存在)
 * 将来Cloud Functions等ヘッダが読める環境へ移行する場合は
 * computeLineSignature を使ったHMAC検証を復活させること。
 */
export const verifySignature = (e: GoogleAppsScript.Events.DoPost | undefined): boolean => {
  if (!e?.postData?.contents) return false;
  try {
    const body: unknown = JSON.parse(e.postData.contents);
    return typeof body === 'object' && body !== null && Array.isArray((body as { events?: unknown }).events);
  } catch {
    return false;
  }
};

/** 参考実装: bodyのHMAC-SHA256をBase64で返す(ヘッダが取れる環境への移行用) */
export const computeLineSignature = (bodyText: string): string => {
  const raw = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(bodyText).getBytes(),
    Utilities.newBlob(CONFIG.LINE_CHANNEL_SECRET).getBytes(),
  );
  return Utilities.base64Encode(raw);
};
