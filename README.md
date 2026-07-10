# LINE Inventory Management

LINE Messaging API と Notion API を Google Apps Script（GAS）から連携し、在庫を管理するためのプロジェクトです。

## セットアップ

1. Node.js をインストールします。
2. `npm install` を実行します。
3. `.clasp.json` の `scriptId` を対象の GAS プロジェクト ID に置き換えます。
4. GAS のスクリプトプロパティに次の値を登録します。
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_CHANNEL_SECRET`
   - `NOTION_TOKEN`
   - `NOTION_INVENTORY_DB_ID`
   - `NOTION_USERS_DB_ID`
5. `npm run push` でソースを GAS に反映します。

詳細な要件と構成は `docs/requirements.md`、`docs/folder-structure.md` を参照してください。
