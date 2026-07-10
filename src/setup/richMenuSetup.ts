/**
 * リッチメニュー登録用ワンショットスクリプト。GASエディタから手動実行する。
 * Webhook処理からは呼ばれない。
 * メニュー定義は assets/richmenu/richmenu.json が正(esbuildがJSONをバンドルする)。
 */
import richMenuDef from '../../assets/richmenu/richmenu.json';
import { CONFIG } from '../config';
import { lineFetch } from '../clients/lineClient';
import { logInfo } from '../utils/logger';

/** 1) メニュー作成 → 2) 画像アップロード → 3) デフォルト設定 を一括実行 */
export const setupRichMenu = (): void => {
  const richMenuId = createRichMenu();
  uploadRichMenuImage(richMenuId);
  setDefaultRichMenu(richMenuId);
  logInfo('setupRichMenu', `done: ${richMenuId}`);
};

/** 登録済みリッチメニューの一覧をログに出す(削除時のID確認用) */
export const listRichMenus = (): void => {
  const res = lineFetch<{ richmenus: Array<{ richMenuId: string; name: string }> }>('get', '/richmenu/list');
  const menus = res?.richmenus ?? [];
  logInfo('listRichMenus', menus.map((menu) => `${menu.richMenuId} (${menu.name})`));
};

/** 指定IDのリッチメニューを削除する(コードから呼ぶ用。GASエディタからは引数を渡せない) */
export const deleteRichMenu = (richMenuId: string): void => {
  lineFetch('delete', `/richmenu/${richMenuId}`);
  logInfo('deleteRichMenu', `deleted: ${richMenuId}`);
};

/** 登録済みリッチメニューを全削除する(作り直し用) */
export const deleteAllRichMenus = (): void => {
  const res = lineFetch<{ richmenus: Array<{ richMenuId: string }> }>('get', '/richmenu/list');
  for (const menu of res?.richmenus ?? []) {
    lineFetch('delete', `/richmenu/${menu.richMenuId}`);
    logInfo('deleteAllRichMenus', `deleted: ${menu.richMenuId}`);
  }
};

const createRichMenu = (): string => {
  const res = lineFetch<{ richMenuId: string }>('post', '/richmenu', richMenuDef);
  if (!res?.richMenuId) throw new Error('richmenu create response was empty');
  return res.richMenuId;
};

/**
 * 画像はスクリプトプロパティ RICHMENU_IMAGE_FILE_ID(DriveのファイルID)から取得。
 * 2500×1686のPNG/JPEG・1MB以下。ホストがapi-data.line.meな点に注意。
 */
const uploadRichMenuImage = (richMenuId: string): void => {
  const blob = DriveApp.getFileById(CONFIG.RICHMENU_IMAGE_FILE_ID).getBlob();
  const res = UrlFetchApp.fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'post',
    headers: { Authorization: `Bearer ${CONFIG.LINE_CHANNEL_ACCESS_TOKEN}` },
    contentType: blob.getContentType() ?? 'image/png',
    payload: blob.getBytes(),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`richmenu image upload failed: ${code} ${res.getContentText()}`);
  }
};

const setDefaultRichMenu = (richMenuId: string): void => {
  lineFetch('post', `/user/all/richmenu/${richMenuId}`);
};
