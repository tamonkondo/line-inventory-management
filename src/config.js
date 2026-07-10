/** スクリプトプロパティから機密値・設定値を読む（コード直書き禁止） */
var CONFIG = {
  get LINE_CHANNEL_ACCESS_TOKEN() { return prop_('LINE_CHANNEL_ACCESS_TOKEN'); },
  get LINE_CHANNEL_SECRET()       { return prop_('LINE_CHANNEL_SECRET'); },
  get NOTION_TOKEN()              { return prop_('NOTION_TOKEN'); },
  // DB構成は後日確定。IDは増減しうるのでここに集約する
  get NOTION_INVENTORY_DB_ID()    { return prop_('NOTION_INVENTORY_DB_ID'); },
  get NOTION_USERS_DB_ID()        { return prop_('NOTION_USERS_DB_ID'); }
};

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}
