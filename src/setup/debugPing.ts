/**
 * セットアップ診断用ワンショット関数。GASエディタから手動実行する。
 * ログ出力・スクリプトプロパティ・Notion 3DBへの接続を順に確認し、
 * どこで失敗したかを実行ログで特定できるようにする。
 */
import { CONFIG } from '../config';
import { NotionClient } from '../clients/notionClient';
import { logInfo } from '../utils/logger';

export const debugPing = (): void => {
  logInfo('debugPing', '1/5 ログ出力: OK');

  // スクリプトプロパティ(値そのものは出さない)
  const tokenLength = CONFIG.NOTION_TOKEN.length;
  logInfo('debugPing', `2/5 スクリプトプロパティ: OK (NOTION_TOKEN length=${tokenLength})`);

  const inventory = NotionClient.queryDataSource(CONFIG.NOTION_INVENTORY_DB_ID, { page_size: 1 });
  logInfo('debugPing', `3/5 在庫DB接続: OK (${inventory.results.length} page)`);

  const users = NotionClient.queryDataSource(CONFIG.NOTION_USERS_DB_ID, { page_size: 1 });
  logInfo('debugPing', `4/5 ユーザーDB接続: OK (${users.results.length} page)`);

  const purchases = NotionClient.queryDataSource(CONFIG.NOTION_PURCHASES_DB_ID, { page_size: 1 });
  logInfo('debugPing', `5/5 購入履歴DB接続: OK (${purchases.results.length} page)`);

  logInfo('debugPing', '✅ すべて正常です(Notion側の設定は問題なし)');
};
