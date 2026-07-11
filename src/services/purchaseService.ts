import { CONFIG, NOTION_PROPS } from '../config';
import { NotionClient } from '../clients/notionClient';
import { NotionMapper } from '../utils/notionMapper';
import type { InventoryItem, Purchase } from '../types';

const P = NOTION_PROPS.PURCHASES;

/** 購入履歴の記録・参照(F-17/F-18)。数量は扱わない(R-08) */
export const PurchaseService = {
  /**
   * 購入を1件記録する。購入日は記録した日(Asia/Tokyo)固定。
   * 在庫DBの「最終購入日」はRollupのため、履歴作成だけで自動更新される。
   * @param item 対象品目
   * @param userPageId 記録者(UserのpageId)。不明ならnull
   */
  record(item: InventoryItem, userPageId: string | null): void {
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    NotionClient.createPage({
      parent: { type: 'data_source_id', data_source_id: CONFIG.NOTION_PURCHASES_DB_ID },
      properties: {
        [P.NAME]: { title: [{ text: { content: `${item.name} ${today}` } }] },
        [P.ITEM]: { relation: [{ id: item.pageId }] },
        [P.PURCHASED_AT]: { date: { start: today } },
        ...(userPageId ? { [P.RECORDED_BY]: { relation: [{ id: userPageId }] } } : {}),
      },
    });
  },

  /** 品目の直近購入履歴(購入日降順・最大limit件、既定5件) */
  listRecent(itemPageId: string, limit = 5): Purchase[] {
    const res = NotionClient.queryDataSource(CONFIG.NOTION_PURCHASES_DB_ID, {
      filter: { property: P.ITEM, relation: { contains: itemPageId } },
      sorts: [{ property: P.PURCHASED_AT, direction: 'descending' }],
      page_size: limit,
    });
    return res.results.map((page) => NotionMapper.toPurchase(page));
  },
};
