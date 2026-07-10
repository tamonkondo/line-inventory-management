/** 在庫の業務ロジック（DBスキーマ確定後に肉付け） */
var InventoryService = {
  // 在庫一覧
  list: function (category) { /* TODO: NotionClient.queryDatabase(...) */ },
  // 追加/加算
  add: function (name, amount, unit) { /* TODO */ },
  // 消費/減算 → しきい値以下なら通知サービスへ
  consume: function (name, amount) { /* TODO */ },
  // 不足一覧
  listShortage: function () { /* TODO */ }
};
