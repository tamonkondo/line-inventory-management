import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installCache } from './helpers/gasMocks';

vi.mock('../src/services/inventoryService', () => ({
  InventoryService: {
    list: vi.fn(), listShortage: vi.fn(), search: vi.fn(), findByName: vi.fn(),
    getByPageId: vi.fn(), create: vi.fn(), setInStock: vi.fn(),
    updateName: vi.fn(), updateStores: vi.fn(), attachPhoto: vi.fn(),
  },
  isDuplicateItemError: (err: unknown) => err instanceof Error && err.message === 'DUPLICATE_ITEM',
}));
vi.mock('../src/services/purchaseService', () => ({
  PurchaseService: { record: vi.fn(), listRecent: vi.fn() },
}));
vi.mock('../src/services/notificationService', () => ({
  NotificationService: { notifyOutOfStock: vi.fn() },
}));
vi.mock('../src/services/userService', () => ({
  UserService: { findByLineUserId: vi.fn() },
}));

import { InventoryService } from '../src/services/inventoryService';
import { PurchaseService } from '../src/services/purchaseService';
import { NotificationService } from '../src/services/notificationService';
import { UserService } from '../src/services/userService';
import { SessionStore } from '../src/utils/sessionStore';
import { routeCommand, executeOut, executeBuy } from '../src/router/commandRouter';
import type { InventoryItem } from '../src/types';

const item = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  pageId: 'page-1', name: '米', inStock: true, category: null, photoUrl: null,
  stores: [], location: null, expiryDate: null, lastPurchasedAt: null, ...overrides,
});

const ctx = { lineUserId: 'U1' };

beforeEach(() => {
  vi.clearAllMocks();
  installCache();
});

describe('routeCommand 基本', () => {
  it('コマンドでないテキストはnull', () => {
    expect(routeCommand('こんにちは', ctx)).toBeNull();
  });

  it('在庫: 0件で案内テキスト、ありでFlex一覧', () => {
    vi.mocked(InventoryService.list).mockReturnValue([]);
    expect(routeCommand('在庫', ctx)?.[0]).toEqual({
      type: 'text', text: 'まだ品目が登録されていません。「新規 品名」で登録できます。',
    });

    vi.mocked(InventoryService.list).mockReturnValue([item()]);
    expect(routeCommand('在庫', ctx)?.[0].type).toBe('flex');
  });

  it('不足: 0件で🎉、ありで一覧', () => {
    vi.mocked(InventoryService.listShortage).mockReturnValue([]);
    expect((routeCommand('不足', ctx)?.[0] as { text: string }).text).toContain('不足はありません');
  });

  it('ヘルプを返す', () => {
    expect((routeCommand('ヘルプ', ctx)?.[0] as { text: string }).text).toContain('使い方');
  });
});

describe('executeOut / なくなった', () => {
  it('在庫ありをOFFにして通知する', () => {
    const target = item({ inStock: true });
    const messages = executeOut(target, ctx);
    expect(InventoryService.setInStock).toHaveBeenCalledWith('page-1', false);
    expect(NotificationService.notifyOutOfStock).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'page-1', inStock: false }), 'U1',
    );
    expect((messages[0] as { text: string }).text).toContain('在庫切れにしました');
  });

  it('すでに在庫切れなら更新も通知もしない', () => {
    const messages = executeOut(item({ inStock: false }), ctx);
    expect(InventoryService.setInStock).not.toHaveBeenCalled();
    expect(NotificationService.notifyOutOfStock).not.toHaveBeenCalled();
    expect((messages[0] as { text: string }).text).toContain('すでに在庫切れ');
  });

  it('「なくなった 品名」で完全一致品目を処理する(検索1回のみ)', () => {
    vi.mocked(InventoryService.search).mockReturnValue([item({ name: '米' }), item({ pageId: 'p2', name: '無洗米' })]);
    routeCommand('なくなった 米', ctx);
    expect(InventoryService.setInStock).toHaveBeenCalledWith('page-1', false);
    expect(InventoryService.search).toHaveBeenCalledTimes(1);
    expect(InventoryService.findByName).not.toHaveBeenCalled();
  });

  it('見つからない品名は案内テキスト', () => {
    vi.mocked(InventoryService.search).mockReturnValue([]);
    const messages = routeCommand('なくなった 謎の品', ctx);
    expect((messages?.[0] as { text: string }).text).toContain('見つかりません');
  });

  it('部分一致1件は自動解決、複数件は選択リスト', () => {
    vi.mocked(InventoryService.search).mockReturnValue([item({ name: '無洗米' })]);
    routeCommand('なくなった 米', ctx);
    expect(InventoryService.setInStock).toHaveBeenCalled();

    vi.clearAllMocks();
    vi.mocked(InventoryService.search).mockReturnValue([
      item({ name: '食器用洗剤' }), item({ pageId: 'page-2', name: '衣類用洗剤' }),
    ]);
    const messages = routeCommand('なくなった 洗剤', ctx);
    expect(messages).toHaveLength(2);
    expect(messages?.[1].type).toBe('flex');
  });

  it('引数なしは在庫ありの選択リスト', () => {
    vi.mocked(InventoryService.list).mockReturnValue([item(), item({ pageId: 'p2', inStock: false })]);
    const messages = routeCommand('なくなった', ctx);
    expect(messages?.[0].type).toBe('flex');
  });
});

describe('executeBuy / 買った', () => {
  it('在庫切れをONに戻し購入を記録する(記録者付き)', () => {
    vi.mocked(UserService.findByLineUserId).mockReturnValue({
      pageId: 'user-page', name: '太郎', lineUserId: 'U1', active: true,
    });
    const target = item({ inStock: false });
    const messages = executeBuy(target, ctx);
    expect(InventoryService.setInStock).toHaveBeenCalledWith('page-1', true);
    expect(PurchaseService.record).toHaveBeenCalledWith(target, 'user-page');
    expect((messages[0] as { text: string }).text).toContain('購入履歴に記録しました');
  });

  it('在庫ありのままでも購入は記録する(no-op更新はスキップ・文言が変わる)', () => {
    vi.mocked(UserService.findByLineUserId).mockReturnValue(null);
    const messages = executeBuy(item({ inStock: true }), ctx);
    expect(InventoryService.setInStock).not.toHaveBeenCalled();
    expect(PurchaseService.record).toHaveBeenCalledWith(expect.anything(), null);
    expect((messages[0] as { text: string }).text).toContain('在庫ありのままです');
  });

  it('購入記録の失敗はフラグ更新済みの旨を伝える(無反応にしない)', () => {
    vi.mocked(UserService.findByLineUserId).mockReturnValue(null);
    vi.mocked(PurchaseService.record).mockImplementation(() => { throw new Error('Notion API error: 500'); });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const messages = executeBuy(item({ inStock: false }), ctx);
    expect(InventoryService.setInStock).toHaveBeenCalledWith('page-1', true);
    expect((messages[0] as { text: string }).text).toContain('購入履歴の記録には失敗');
  });

  it('引数なしは在庫切れの選択リスト(list 1回で在庫切れ0件なら全品目)', () => {
    vi.mocked(InventoryService.list).mockReturnValue([item(), item({ pageId: 'p2', inStock: false })]);
    expect(routeCommand('買った', ctx)?.[0].type).toBe('flex');
    expect(InventoryService.listShortage).not.toHaveBeenCalled();

    vi.mocked(InventoryService.list).mockReturnValue([item()]);
    expect(routeCommand('買った', ctx)?.[0].type).toBe('flex');
    expect(InventoryService.list).toHaveBeenCalledTimes(2);
  });
});

describe('新規登録', () => {
  it('作成成功でカード+写真案内、attach_photoセッションをセット', () => {
    vi.mocked(InventoryService.create).mockReturnValue(item({ pageId: 'new-page', name: 'ラップ' }));
    const messages = routeCommand('新規 ラップ', ctx);
    expect(messages).toHaveLength(3);
    expect(SessionStore.get('U1')).toEqual({ flow: 'attach_photo', step: 'wait', data: { pageId: 'new-page' } });
  });

  it('重複はDUPLICATE_ITEMを文言に変換', () => {
    vi.mocked(InventoryService.create).mockImplementation(() => { throw new Error('DUPLICATE_ITEM'); });
    const messages = routeCommand('新規 米', ctx);
    expect((messages?.[0] as { text: string }).text).toContain('すでに登録されています');
  });

  it('引数なしはnameセッションをセットして品名を促す', () => {
    const messages = routeCommand('新規', ctx);
    expect((messages?.[0] as { text: string }).text).toContain('品名を送ってください');
    expect(SessionStore.get('U1')).toEqual({ flow: 'new', step: 'name' });
  });
});

describe('履歴・検索・編集', () => {
  it('履歴: 日付一覧のテキストを返す', () => {
    vi.mocked(InventoryService.search).mockReturnValue([item({ name: '米' })]);
    vi.mocked(PurchaseService.listRecent).mockReturnValue([
      { pageId: 'h1', itemPageId: 'page-1', purchasedAt: '2026-07-10', store: null },
      { pageId: 'h2', itemPageId: 'page-1', purchasedAt: '2026-07-01', store: null },
    ]);
    const messages = routeCommand('履歴 米', ctx);
    expect((messages?.[0] as { text: string }).text).toBe('米 の購入履歴\n・2026-07-10\n・2026-07-01');
  });

  it('履歴: 0件・引数なしの案内', () => {
    vi.mocked(InventoryService.search).mockReturnValue([item({ name: '米' })]);
    vi.mocked(PurchaseService.listRecent).mockReturnValue([]);
    expect((routeCommand('履歴 米', ctx)?.[0] as { text: string }).text).toContain('まだありません');
    expect((routeCommand('履歴', ctx)?.[0] as { text: string }).text).toContain('「履歴 品名」');
  });

  it('検索: ヒットで一覧、0件で案内', () => {
    vi.mocked(InventoryService.search).mockReturnValue([item()]);
    expect(routeCommand('検索 米', ctx)?.[0].type).toBe('flex');
    vi.mocked(InventoryService.search).mockReturnValue([]);
    expect((routeCommand('検索 ない', ctx)?.[0] as { text: string }).text).toContain('見つかりませんでした');
  });

  it('編集: 編集メニューFlexを返す', () => {
    vi.mocked(InventoryService.search).mockReturnValue([item({ name: '米' })]);
    const messages = routeCommand('編集 米', ctx);
    expect(messages?.[0].type).toBe('flex');
    if (messages?.[0].type === 'flex') expect(messages[0].altText).toContain('編集');
  });
});
