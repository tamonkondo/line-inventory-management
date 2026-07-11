import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installProperties } from './helpers/gasMocks';

vi.mock('../src/clients/notionClient', () => ({
  NotionClient: {
    queryDataSource: vi.fn(),
    queryAll: vi.fn(),
    createPage: vi.fn(),
    updatePage: vi.fn(),
    retrievePage: vi.fn(),
  },
}));

import { NotionClient, type NotionPage } from '../src/clients/notionClient';
import { InventoryService } from '../src/services/inventoryService';

const itemPage = (id: string, name: string, inStock: boolean): NotionPage => ({
  id,
  properties: {
    '品名': { type: 'title', title: [{ plain_text: name }] },
    '在庫あり': { type: 'checkbox', checkbox: inStock },
  },
});

const emptyQuery = { results: [], has_more: false, next_cursor: null };

beforeEach(() => {
  vi.clearAllMocks();
  installProperties({ NOTION_INVENTORY_DB_ID: 'inv-db' });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('InventoryService 参照系', () => {
  it('listがカテゴリ→品名ソートで全件取得する', () => {
    vi.mocked(NotionClient.queryAll).mockReturnValue([itemPage('a', '米', true)]);
    const items = InventoryService.list();
    expect(items[0].name).toBe('米');
    expect(vi.mocked(NotionClient.queryAll).mock.calls[0][1]).toEqual({
      sorts: [
        { property: 'カテゴリ', direction: 'ascending' },
        { property: '品名', direction: 'ascending' },
      ],
    });
  });

  it('listShortageがcheckbox=falseフィルタを使う', () => {
    vi.mocked(NotionClient.queryAll).mockReturnValue([]);
    InventoryService.listShortage();
    const payload = vi.mocked(NotionClient.queryAll).mock.calls[0][1] as { filter: unknown };
    expect(payload.filter).toEqual({ property: '在庫あり', checkbox: { equals: false } });
  });

  it('findByNameが0件でnull、複数件で先頭+エラーログ', () => {
    vi.mocked(NotionClient.queryDataSource).mockReturnValue(emptyQuery);
    expect(InventoryService.findByName('ない')).toBeNull();

    vi.mocked(NotionClient.queryDataSource).mockReturnValue({
      results: [itemPage('a', '米', true), itemPage('b', '米', false)],
      has_more: false, next_cursor: null,
    });
    const item = InventoryService.findByName('米');
    expect(item?.pageId).toBe('a');
    expect(console.error).toHaveBeenCalled();
  });
});

describe('InventoryService.create', () => {
  it('重複名でDUPLICATE_ITEMを投げる', () => {
    vi.mocked(NotionClient.queryDataSource).mockReturnValue({
      results: [itemPage('a', '米', true)], has_more: false, next_cursor: null,
    });
    expect(() => InventoryService.create({ name: '米' })).toThrow('DUPLICATE_ITEM');
    expect(NotionClient.createPage).not.toHaveBeenCalled();
  });

  it('inStock=trueで作成し、任意項目は渡された場合のみ含める', () => {
    vi.mocked(NotionClient.queryDataSource).mockReturnValue(emptyQuery);
    vi.mocked(NotionClient.createPage).mockReturnValue(itemPage('new', 'トイレットペーパー', true));

    const item = InventoryService.create({ name: 'トイレットペーパー', stores: ['スーパー'] });
    expect(item.inStock).toBe(true);
    const payload = vi.mocked(NotionClient.createPage).mock.calls[0][0] as {
      properties: Record<string, unknown>;
    };
    expect(payload.properties['在庫あり']).toEqual({ checkbox: true });
    expect(payload.properties['購入先']).toEqual({ multi_select: [{ name: 'スーパー' }] });
    expect(payload.properties['カテゴリ']).toBeUndefined();
  });
});

describe('InventoryService 更新系', () => {
  it('setInStockがcheckboxを更新する', () => {
    InventoryService.setInStock('page-1', false);
    expect(NotionClient.updatePage).toHaveBeenCalledWith('page-1', {
      properties: { '在庫あり': { checkbox: false } },
    });
  });

  it('updateNameが別ページの同名でDUPLICATE_ITEM、同一ページなら許可', () => {
    vi.mocked(NotionClient.queryDataSource).mockReturnValue({
      results: [itemPage('other', '米', true)], has_more: false, next_cursor: null,
    });
    expect(() => InventoryService.updateName('page-1', '米')).toThrow('DUPLICATE_ITEM');

    vi.mocked(NotionClient.queryDataSource).mockReturnValue({
      results: [itemPage('page-1', '米', true)], has_more: false, next_cursor: null,
    });
    InventoryService.updateName('page-1', '米');
    expect(NotionClient.updatePage).toHaveBeenCalledWith('page-1', {
      properties: { '品名': { title: [{ text: { content: '米' } }] } },
    });
  });

  it('attachPhotoがfile_upload形式で写真を置き換える', () => {
    InventoryService.attachPhoto('page-1', 'fu-1', 'photo.jpg');
    expect(NotionClient.updatePage).toHaveBeenCalledWith('page-1', {
      properties: {
        '写真': { files: [{ type: 'file_upload', name: 'photo.jpg', file_upload: { id: 'fu-1' } }] },
      },
    });
  });

  it('getByPageIdは取得失敗(削除済み等)でnullを返す(例外を漏らさない)', () => {
    vi.mocked(NotionClient.retrievePage).mockImplementation(() => { throw new Error('Notion API error: 404'); });
    expect(InventoryService.getByPageId('gone')).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });

  it('数量ベースのメソッド(add/consume)が存在しない', () => {
    expect((InventoryService as Record<string, unknown>).add).toBeUndefined();
    expect((InventoryService as Record<string, unknown>).consume).toBeUndefined();
  });
});
