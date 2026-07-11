import { CONFIG, NOTION_PROPS } from '../config';
import { NotionClient } from '../clients/notionClient';
import { NotionMapper } from '../utils/notionMapper';
import { logError } from '../utils/logger';
import type { InventoryItem } from '../types';

const DUPLICATE_ITEM = 'DUPLICATE_ITEM';

/** InventoryService.create / updateName が投げる品名重複エラーの判定 */
export const isDuplicateItemError = (err: unknown): boolean =>
  err instanceof Error && err.message === DUPLICATE_ITEM;

const P = NOTION_PROPS.INVENTORY;

const defaultSorts = [
  { property: P.CATEGORY, direction: 'ascending' },
  { property: P.NAME, direction: 'ascending' },
];

/** 在庫の業務ロジック(boolean管理: R-08。数量・しきい値の概念は持たない) */
export const InventoryService = {
  /** 全品目(カテゴリ→品名順) */
  list(): InventoryItem[] {
    return NotionClient.queryAll(CONFIG.NOTION_INVENTORY_DB_ID, { sorts: defaultSorts })
      .map((page) => NotionMapper.toInventoryItem(page));
  },

  /** 在庫切れ(InStock=false)のみ */
  listShortage(): InventoryItem[] {
    return NotionClient.queryAll(CONFIG.NOTION_INVENTORY_DB_ID, {
      filter: { property: P.IN_STOCK, checkbox: { equals: false } },
      sorts: defaultSorts,
    }).map((page) => NotionMapper.toInventoryItem(page));
  },

  /** 品名部分一致 */
  search(keyword: string): InventoryItem[] {
    return NotionClient.queryAll(CONFIG.NOTION_INVENTORY_DB_ID, {
      filter: { property: P.NAME, title: { contains: keyword } },
      sorts: defaultSorts,
    }).map((page) => NotionMapper.toInventoryItem(page));
  },

  /** 品名完全一致。複数ヒット時はログを残して先頭を返す */
  findByName(name: string): InventoryItem | null {
    const res = NotionClient.queryDataSource(CONFIG.NOTION_INVENTORY_DB_ID, {
      filter: { property: P.NAME, title: { equals: name } },
      page_size: 2,
    });
    if (res.results.length === 0) return null;
    if (res.results.length > 1) {
      logError('InventoryService', `同名品目が複数: ${name}`);
    }
    return NotionMapper.toInventoryItem(res.results[0]);
  },

  /** 取得失敗(削除済み・一時エラー)はnull(呼び出し側が案内を返せるように例外を漏らさない) */
  getByPageId(pageId: string): InventoryItem | null {
    try {
      return NotionMapper.toInventoryItem(NotionClient.retrievePage(pageId));
    } catch (err) {
      logError('InventoryService.getByPageId', err);
      return null;
    }
  },

  /** 新規品目を在庫あり(inStock=true)で作成。同名があれば DUPLICATE_ITEM */
  create(input: { name: string; category?: string; stores?: string[] }): InventoryItem {
    if (this.findByName(input.name)) throw new Error(DUPLICATE_ITEM);
    const page = NotionClient.createPage({
      parent: { type: 'data_source_id', data_source_id: CONFIG.NOTION_INVENTORY_DB_ID },
      properties: NotionMapper.buildInventoryProperties({
        name: input.name,
        inStock: true,
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.stores !== undefined ? { stores: input.stores } : {}),
      }),
    });
    return NotionMapper.toInventoryItem(page);
  },

  setInStock(pageId: string, inStock: boolean): void {
    NotionClient.updatePage(pageId, {
      properties: NotionMapper.buildInventoryProperties({ inStock }),
    });
  },

  /** 名前変更。別ページに同名があれば DUPLICATE_ITEM */
  updateName(pageId: string, newName: string): void {
    const existing = this.findByName(newName);
    if (existing && existing.pageId !== pageId) throw new Error(DUPLICATE_ITEM);
    NotionClient.updatePage(pageId, {
      properties: NotionMapper.buildInventoryProperties({ name: newName }),
    });
  },

  /** 購入先の全置換(未知の選択肢名はNotionが自動追加する) */
  updateStores(pageId: string, stores: string[]): void {
    NotionClient.updatePage(pageId, {
      properties: NotionMapper.buildInventoryProperties({ stores }),
    });
  },

  /** 写真の添付(既存写真は置き換え・1枚運用) */
  attachPhoto(pageId: string, fileUploadId: string, filename: string): void {
    NotionClient.updatePage(pageId, {
      properties: NotionMapper.buildInventoryProperties({
        photoFileUpload: { id: fileUploadId, filename },
      }),
    });
  },
};
