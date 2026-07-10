/**
 * GASへの公開点。
 * esbuild-gas-plugin は global に代入された関数だけをGASのトップレベル関数として出力する。
 * ここに書かないとGASエディタ・Webhookから見えない。
 */
import { doGet, doPost } from './main';
import { setupRichMenu, listRichMenus, deleteAllRichMenus } from './setup/richMenuSetup';

declare const global: Record<string, unknown>;

// Webhook エンドポイント
global.doPost = doPost;
global.doGet = doGet;

// セットアップ用(GASエディタから手動実行)
global.setupRichMenu = setupRichMenu;
global.listRichMenus = listRichMenus;
global.deleteAllRichMenus = deleteAllRichMenus;
