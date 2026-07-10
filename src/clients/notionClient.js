/** Notion API 薄いラッパー（DB仕様に依存しない汎用I/F） */
var NotionClient = {
  queryDatabase: function (databaseId, payload) {
    return notionFetch_('POST', '/databases/' + databaseId + '/query', payload);
  },
  createPage: function (payload) {
    return notionFetch_('POST', '/pages', payload);
  },
  updatePage: function (pageId, payload) {
    return notionFetch_('PATCH', '/pages/' + pageId, payload);
  }
};

function notionFetch_(method, path, payload) {
  var res = UrlFetchApp.fetch('https://api.notion.com/v1' + path, {
    method: method,
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + CONFIG.NOTION_TOKEN,
      'Notion-Version': '2022-06-28'
    },
    payload: payload ? JSON.stringify(payload) : null,
    muteHttpExceptions: true
  });
  return JSON.parse(res.getContentText());
}
