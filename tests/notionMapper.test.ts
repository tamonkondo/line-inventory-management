import { describe, it, expect } from 'vitest';
import { NotionMapper } from '../src/utils/notionMapper';
import type { NotionPage } from '../src/clients/notionClient';

describe('NotionMapper.toInventoryItem', () => {
  it('全プロパティ設定済みのページを変換する', () => {
    const page: NotionPage = {
      id: 'page-1',
      properties: {
        '品名': { type: 'title', title: [{ plain_text: '食器用洗剤' }] },
        '在庫あり': { type: 'checkbox', checkbox: true },
        'カテゴリ': { type: 'select', select: { name: '洗剤' } },
        '写真': { type: 'files', files: [{ type: 'file', name: 'p.jpg', file: { url: 'https://img/signed' } }] },
        '購入先': { type: 'multi_select', multi_select: [{ name: 'スーパー' }, { name: 'Amazon' }] },
        'メモ': { type: 'rich_text', rich_text: [{ plain_text: '詰め替え用を買う' }] },
        '最終購入日': { type: 'rollup', rollup: { type: 'date', date: { start: '2026-07-01T00:00:00.000+09:00' } } },
      },
    };
    expect(NotionMapper.toInventoryItem(page)).toEqual({
      pageId: 'page-1',
      name: '食器用洗剤',
      inStock: true,
      category: '洗剤',
      photoUrl: 'https://img/signed',
      stores: ['スーパー', 'Amazon'],
      memo: '詰め替え用を買う',
      lastPurchasedAt: '2026-07-01',
    });
  });

  it('プロパティ未設定・空のページでも例外にならない', () => {
    const item = NotionMapper.toInventoryItem({ id: 'empty', properties: {} });
    expect(item).toEqual({
      pageId: 'empty',
      name: '',
      inStock: false,
      category: null,
      photoUrl: null,
      stores: [],
      memo: null,
      lastPurchasedAt: null,
    });
  });

  it('external形式の写真URLを読む', () => {
    const page: NotionPage = {
      id: 'p',
      properties: { '写真': { type: 'files', files: [{ type: 'external', external: { url: 'https://ex/img.png' } }] } },
    };
    expect(NotionMapper.toInventoryItem(page).photoUrl).toBe('https://ex/img.png');
  });
});

describe('NotionMapper.toUser / toPurchase', () => {
  it('ユーザーページを変換し、有効判定する', () => {
    const page: NotionPage = {
      id: 'u1',
      properties: {
        '表示名': { type: 'title', title: [{ plain_text: '太郎' }] },
        'LINE User ID': { type: 'rich_text', rich_text: [{ plain_text: 'Uabc' }] },
        'ステータス': { type: 'select', select: { name: '有効' } },
      },
    };
    expect(NotionMapper.toUser(page)).toEqual({ pageId: 'u1', name: '太郎', lineUserId: 'Uabc', active: true });
  });

  it('無効ユーザーはactive=false', () => {
    const page: NotionPage = {
      id: 'u2',
      properties: { 'ステータス': { type: 'select', select: { name: '無効' } } },
    };
    expect(NotionMapper.toUser(page).active).toBe(false);
  });

  it('購入履歴ページを変換する', () => {
    const page: NotionPage = {
      id: 'h1',
      properties: {
        '対象品目': { type: 'relation', relation: [{ id: 'item-1' }] },
        '購入日': { type: 'date', date: { start: '2026-07-10' } },
        '購入先': { type: 'select', select: { name: 'スーパー' } },
      },
    };
    expect(NotionMapper.toPurchase(page)).toEqual({
      pageId: 'h1', itemPageId: 'item-1', purchasedAt: '2026-07-10', store: 'スーパー',
    });
  });
});

describe('NotionMapper.buildInventoryProperties', () => {
  it('空入力で空オブジェクトを返す', () => {
    expect(NotionMapper.buildInventoryProperties({})).toEqual({});
  });

  it('inStock=false もプロパティに含める', () => {
    expect(NotionMapper.buildInventoryProperties({ inStock: false })).toEqual({
      '在庫あり': { checkbox: false },
    });
  });

  it('渡されたキーだけを変換する', () => {
    const props = NotionMapper.buildInventoryProperties({
      name: '米',
      stores: ['スーパー'],
      photoFileUpload: { id: 'fu-1', filename: 'photo.jpg' },
    });
    expect(props).toEqual({
      '品名': { title: [{ text: { content: '米' } }] },
      '購入先': { multi_select: [{ name: 'スーパー' }] },
      '写真': { files: [{ type: 'file_upload', name: 'photo.jpg', file_upload: { id: 'fu-1' } }] },
    });
  });
});
