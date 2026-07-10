/** LINE Webhook 受信エントリポイント(実装書02で本実装に置き換えるプレースホルダ) */
export const doPost = (_e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput =>
  ContentService.createTextOutput('OK');

/** 動作確認用(ブラウザアクセス) */
export const doGet = (): GoogleAppsScript.Content.TextOutput =>
  ContentService.createTextOutput('LINE Inventory Bot is running.');
