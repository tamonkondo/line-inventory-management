const prop = (key: string): string => {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error(`Missing script property: ${key}`);
  return value;
};

/** スクリプトプロパティから機密値・設定値を読む(コード直書き禁止)。キー一覧は .env.example 参照 */
export const CONFIG = {
  get LINE_CHANNEL_ACCESS_TOKEN() { return prop('LINE_CHANNEL_ACCESS_TOKEN'); },
  get LINE_CHANNEL_SECRET()       { return prop('LINE_CHANNEL_SECRET'); },
  get NOTION_TOKEN()              { return prop('NOTION_TOKEN'); },
  get NOTION_INVENTORY_DB_ID()    { return prop('NOTION_INVENTORY_DB_ID'); },
  get NOTION_USERS_DB_ID()        { return prop('NOTION_USERS_DB_ID'); },
  get NOTION_PURCHASES_DB_ID()    { return prop('NOTION_PURCHASES_DB_ID'); },
  get RICHMENU_IMAGE_FILE_ID()    { return prop('RICHMENU_IMAGE_FILE_ID'); },
};

/** Notion DBのプロパティ名(スキーマ変更時はここだけ直す)。docs/notion-schema.md と一致させる */
export const NOTION_PROPS = {
  INVENTORY: {
    NAME: '品名',                 // Title
    IN_STOCK: '在庫あり',         // Checkbox
    CATEGORY: 'カテゴリ',         // Select
    PHOTO: '写真',                // Files & media
    STORES: '購入先',             // Multi-select
    LAST_PURCHASED: '最終購入日', // Rollup(date)
    PURCHASES: '購入履歴',        // Relation → PurchaseHistory
    UPDATED_BY: '更新者',         // Relation → Users
  },
  USERS: {
    NAME: '表示名',               // Title
    LINE_USER_ID: 'LINE User ID', // Rich text
    STATUS: 'ステータス',         // Select('有効' | '無効')
    REGISTERED_AT: '登録日',      // Date
  },
  PURCHASES: {
    NAME: '名前',                 // Title
    ITEM: '対象品目',             // Relation → Inventory
    PURCHASED_AT: '購入日',       // Date
    STORE: '購入先',              // Select
    RECORDED_BY: '記録者',        // Relation → Users
  },
} as const;

/** ステータスSelectの値 */
export const USER_STATUS = { ACTIVE: '有効', INACTIVE: '無効' } as const;
