import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installProperties, installUtilities } from './helpers/gasMocks';

vi.mock('../src/clients/notionClient', () => ({
  NotionClient: { queryDatabase: vi.fn(), createPage: vi.fn() },
}));

import { NotionClient } from '../src/clients/notionClient';
import { PurchaseService } from '../src/services/purchaseService';
import type { InventoryItem } from '../src/types';

const item: InventoryItem = {
  pageId: 'item-1', name: '米', inStock: false, category: null, photoUrl: null,
  stores: [], memo: null, lastPurchasedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  installProperties({ NOTION_PURCHASES_DB_ID: 'purchases-db' });
  installUtilities('2026-07-10');
});

describe('PurchaseService.record', () => {
  it('タイトル・Relation・購入日・記録者を設定して作成する', () => {
    PurchaseService.record(item, 'user-page-1');
    const payload = vi.mocked(NotionClient.createPage).mock.calls[0][0] as {
      parent: { database_id: string };
      properties: Record<string, unknown>;
    };
    expect(payload.parent.database_id).toBe('purchases-db');
    expect(payload.properties['名前']).toEqual({ title: [{ text: { content: '米 2026-07-10' } }] });
    expect(payload.properties['対象品目']).toEqual({ relation: [{ id: 'item-1' }] });
    expect(payload.properties['購入日']).toEqual({ date: { start: '2026-07-10' } });
    expect(payload.properties['記録者']).toEqual({ relation: [{ id: 'user-page-1' }] });
  });

  it('userPageId=nullなら記録者を含めない', () => {
    PurchaseService.record(item, null);
    const payload = vi.mocked(NotionClient.createPage).mock.calls[0][0] as {
      properties: Record<string, unknown>;
    };
    expect(payload.properties['記録者']).toBeUndefined();
  });
});

describe('PurchaseService.listRecent', () => {
  it('対象品目フィルタ+購入日降順で問い合わせる', () => {
    vi.mocked(NotionClient.queryDatabase).mockReturnValue({
      results: [{
        id: 'h1',
        properties: {
          '対象品目': { type: 'relation', relation: [{ id: 'item-1' }] },
          '購入日': { type: 'date', date: { start: '2026-07-10' } },
        },
      }],
      has_more: false, next_cursor: null,
    });
    const purchases = PurchaseService.listRecent('item-1', 3);
    expect(purchases[0].purchasedAt).toBe('2026-07-10');
    expect(vi.mocked(NotionClient.queryDatabase).mock.calls[0][1]).toEqual({
      filter: { property: '対象品目', relation: { contains: 'item-1' } },
      sorts: [{ property: '購入日', direction: 'descending' }],
      page_size: 3,
    });
  });

  it('limit省略時は5件', () => {
    vi.mocked(NotionClient.queryDatabase).mockReturnValue({ results: [], has_more: false, next_cursor: null });
    PurchaseService.listRecent('item-1');
    expect((vi.mocked(NotionClient.queryDatabase).mock.calls[0][1] as { page_size: number }).page_size).toBe(5);
  });
});
