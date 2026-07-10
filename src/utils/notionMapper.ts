import { NOTION_PROPS, USER_STATUS } from '../config';
import type { NotionPage, NotionPropertyValue } from '../clients/notionClient';
import type { InventoryItem, User, Purchase } from '../types';

/** InventoryItemの部分更新入力 */
export interface InventoryPropertiesInput {
  name?: string;
  inStock?: boolean;
  category?: string;
  stores?: string[];
  photoFileUpload?: { id: string; filename: string };
}

const propOf = (page: NotionPage, name: string): NotionPropertyValue | undefined =>
  page.properties?.[name];

const propTitle = (page: NotionPage, name: string): string =>
  (propOf(page, name)?.title ?? [])
    .map((t) => t.plain_text ?? t.text?.content ?? '')
    .join('');

const propCheckbox = (page: NotionPage, name: string): boolean =>
  propOf(page, name)?.checkbox ?? false;

const propSelect = (page: NotionPage, name: string): string | null =>
  propOf(page, name)?.select?.name ?? null;

const propMultiSelect = (page: NotionPage, name: string): string[] =>
  (propOf(page, name)?.multi_select ?? []).map((option) => option.name);

const propRichText = (page: NotionPage, name: string): string =>
  (propOf(page, name)?.rich_text ?? []).map((t) => t.plain_text ?? '').join('');

const toDatePart = (start: string | undefined | null): string | null =>
  start ? start.slice(0, 10) : null;

const propDate = (page: NotionPage, name: string): string | null =>
  toDatePart(propOf(page, name)?.date?.start);

const propRollupDate = (page: NotionPage, name: string): string | null => {
  const rollup = propOf(page, name)?.rollup;
  return rollup?.type === 'date' ? toDatePart(rollup.date?.start) : null;
};

const propFilesFirstUrl = (page: NotionPage, name: string): string | null => {
  const first = (propOf(page, name)?.files ?? [])[0];
  if (!first) return null;
  // type:'file'(Notionアップロード)のURLは1時間で失効する署名付きURL。保存せず取得直後に使うこと
  if (first.type === 'file') return first.file?.url ?? null;
  if (first.type === 'external') return first.external?.url ?? null;
  return null;
};

const propRelationIds = (page: NotionPage, name: string): string[] =>
  (propOf(page, name)?.relation ?? []).map((rel) => rel.id);

/** Notionページ⇔ドメインオブジェクトの変換(スキーマ依存はここに集約) */
export const NotionMapper = {
  /** 在庫DBのページ → InventoryItem */
  toInventoryItem(page: NotionPage): InventoryItem {
    const P = NOTION_PROPS.INVENTORY;
    return {
      pageId: page.id,
      name: propTitle(page, P.NAME),
      inStock: propCheckbox(page, P.IN_STOCK),
      category: propSelect(page, P.CATEGORY),
      photoUrl: propFilesFirstUrl(page, P.PHOTO),
      stores: propMultiSelect(page, P.STORES),
      location: propSelect(page, P.LOCATION),
      expiryDate: propDate(page, P.EXPIRY),
      lastPurchasedAt: propRollupDate(page, P.LAST_PURCHASED),
    };
  },

  /** ユーザーDBのページ → User */
  toUser(page: NotionPage): User {
    const P = NOTION_PROPS.USERS;
    return {
      pageId: page.id,
      name: propTitle(page, P.NAME),
      lineUserId: propRichText(page, P.LINE_USER_ID),
      active: propSelect(page, P.STATUS) === USER_STATUS.ACTIVE,
    };
  },

  /** 購入履歴DBのページ → Purchase */
  toPurchase(page: NotionPage): Purchase {
    const P = NOTION_PROPS.PURCHASES;
    return {
      pageId: page.id,
      itemPageId: propRelationIds(page, P.ITEM)[0] ?? null,
      purchasedAt: propDate(page, P.PURCHASED_AT),
      store: propSelect(page, P.STORE),
    };
  },

  /** InventoryItemの部分更新 → Notion propertiesペイロード(渡されたキーだけ変換) */
  buildInventoryProperties(partial: InventoryPropertiesInput): Record<string, unknown> {
    const P = NOTION_PROPS.INVENTORY;
    const properties: Record<string, unknown> = {};
    if (partial.name !== undefined) {
      properties[P.NAME] = { title: [{ text: { content: partial.name } }] };
    }
    if (partial.inStock !== undefined) {
      properties[P.IN_STOCK] = { checkbox: partial.inStock };
    }
    if (partial.category !== undefined) {
      properties[P.CATEGORY] = { select: { name: partial.category } };
    }
    if (partial.stores !== undefined) {
      properties[P.STORES] = { multi_select: partial.stores.map((store) => ({ name: store })) };
    }
    if (partial.photoFileUpload !== undefined) {
      properties[P.PHOTO] = {
        files: [{
          type: 'file_upload',
          name: partial.photoFileUpload.filename,
          file_upload: { id: partial.photoFileUpload.id },
        }],
      };
    }
    return properties;
  },
};
