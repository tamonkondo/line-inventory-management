import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installCache } from './helpers/gasMocks';

vi.mock('../src/clients/lineClient', () => ({
  LineClient: { reply: vi.fn(), push: vi.fn(), multicast: vi.fn() },
}));
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
vi.mock('../src/handlers/imageHandler', () => ({
  handleImageMessage: vi.fn(),
}));

import { LineClient } from '../src/clients/lineClient';
import { InventoryService } from '../src/services/inventoryService';
import { PurchaseService } from '../src/services/purchaseService';
import { NotificationService } from '../src/services/notificationService';
import { handleImageMessage } from '../src/handlers/imageHandler';
import { SessionStore } from '../src/utils/sessionStore';
import { handlePostback } from '../src/handlers/postbackHandler';
import { handleMessage } from '../src/handlers/messageHandler';
import type { InventoryItem, LineMessage, LineWebhookEvent } from '../src/types';

const item = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  pageId: 'page-1', name: '米', inStock: true, category: null, photoUrl: null,
  stores: [], location: null, expiryDate: null, lastPurchasedAt: null, ...overrides,
});

const postbackEvent = (data: string): LineWebhookEvent =>
  ({ type: 'postback', replyToken: 'rt', source: { userId: 'U1' }, postback: { data } });

const textEvent = (input: string): LineWebhookEvent =>
  ({ type: 'message', replyToken: 'rt', source: { userId: 'U1' }, message: { id: 'm1', type: 'text', text: input } });

const repliedMessages = (): LineMessage[] => {
  const calls = vi.mocked(LineClient.reply).mock.calls;
  return calls[calls.length - 1][1];
};

beforeEach(() => {
  vi.clearAllMocks();
  installCache();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('handlePostback', () => {
  it('action=listで在庫一覧を返す(routeCommand再利用)', () => {
    vi.mocked(InventoryService.list).mockReturnValue([item()]);
    handlePostback(postbackEvent('action=list'));
    expect(repliedMessages()[0].type).toBe('flex');
  });

  it('out&step=pickで在庫切れ化+通知', () => {
    vi.mocked(InventoryService.getByPageId).mockReturnValue(item({ inStock: true }));
    handlePostback(postbackEvent('action=out&step=pick&id=page-1'));
    expect(InventoryService.setInStock).toHaveBeenCalledWith('page-1', false);
    expect(NotificationService.notifyOutOfStock).toHaveBeenCalled();
  });

  it('buy&step=pickで在庫あり化+購入記録', () => {
    vi.mocked(InventoryService.getByPageId).mockReturnValue(item({ inStock: false }));
    handlePostback(postbackEvent('action=buy&step=pick&id=page-1'));
    expect(InventoryService.setInStock).toHaveBeenCalledWith('page-1', true);
    expect(PurchaseService.record).toHaveBeenCalled();
  });

  it('detailで品目カード+直近履歴3件', () => {
    vi.mocked(InventoryService.getByPageId).mockReturnValue(item());
    vi.mocked(PurchaseService.listRecent).mockReturnValue([]);
    handlePostback(postbackEvent('action=detail&id=page-1'));
    expect(PurchaseService.listRecent).toHaveBeenCalledWith('page-1', 3);
    expect(repliedMessages()[0].type).toBe('flex');
  });

  it('edit&step=field&field=nameでセッションをセットして入力を促す', () => {
    handlePostback(postbackEvent('action=edit&step=field&field=name&id=page-1'));
    expect(SessionStore.get('U1')).toEqual({ flow: 'edit', step: 'name', data: { pageId: 'page-1' } });
    expect((repliedMessages()[0] as { text: string }).text).toContain('新しい名前');
  });

  it('edit&step=field&field=photoでattach_photoセッション', () => {
    handlePostback(postbackEvent('action=edit&step=field&field=photo&id=page-1'));
    expect(SessionStore.get('U1')).toEqual({ flow: 'attach_photo', step: 'wait', data: { pageId: 'page-1' } });
  });

  it('cancelでセッションを破棄する', () => {
    SessionStore.set('U1', { flow: 'new', step: 'name' });
    handlePostback(postbackEvent('action=cancel'));
    expect(SessionStore.get('U1')).toBeNull();
    expect((repliedMessages()[0] as { text: string }).text).toBe('キャンセルしました。');
  });

  it('postbackのタップは残っていたセッションを破棄する(新規登録待ちの取り違え防止)', () => {
    SessionStore.set('U1', { flow: 'new', step: 'name' });
    vi.mocked(InventoryService.list).mockReturnValue([item()]);
    handlePostback(postbackEvent('action=list'));
    expect(SessionStore.get('U1')).toBeNull();
  });

  it('不正な%シーケンスを含むpostback dataでもクラッシュしない', () => {
    vi.mocked(InventoryService.getByPageId).mockReturnValue(null);
    expect(() => handlePostback(postbackEvent('action=out&step=pick&id=%E0%A4%A'))).not.toThrow();
    expect((repliedMessages()[0] as { text: string }).text).toBe('操作をやり直してください。');
  });

  it('存在しないpageIdや不明actionは案内を返す', () => {
    vi.mocked(InventoryService.getByPageId).mockReturnValue(null);
    handlePostback(postbackEvent('action=out&step=pick&id=gone'));
    expect((repliedMessages()[0] as { text: string }).text).toBe('操作をやり直してください。');

    handlePostback(postbackEvent('action=unknown'));
    expect((repliedMessages()[0] as { text: string }).text).toBe('操作をやり直してください。');
  });

  it('userId・replyTokenがなければ何もしない', () => {
    handlePostback({ type: 'postback', source: {}, postback: { data: 'action=list' } });
    expect(LineClient.reply).not.toHaveBeenCalled();
  });
});

describe('handleMessage', () => {
  it('画像はimageHandlerへ委譲する', () => {
    handleMessage({ type: 'message', replyToken: 'rt', source: { userId: 'U1' }, message: { id: 'm1', type: 'image' } });
    expect(handleImageMessage).toHaveBeenCalled();
    expect(LineClient.reply).not.toHaveBeenCalled();
  });

  it('スタンプ等は無視する', () => {
    handleMessage({ type: 'message', replyToken: 'rt', source: { userId: 'U1' }, message: { id: 'm1', type: 'sticker' } });
    expect(LineClient.reply).not.toHaveBeenCalled();
  });

  it('「キャンセル」でセッション破棄', () => {
    SessionStore.set('U1', { flow: 'new', step: 'name' });
    handleMessage(textEvent('キャンセル'));
    expect(SessionStore.get('U1')).toBeNull();
  });

  it('コマンドでないテキストはフォールバック', () => {
    handleMessage(textEvent('こんにちは'));
    expect((repliedMessages()[0] as { text: string }).text).toContain('ヘルプ');
  });

  it('newセッション中の品名入力で登録→attach_photoへ遷移', () => {
    SessionStore.set('U1', { flow: 'new', step: 'name' });
    vi.mocked(InventoryService.create).mockReturnValue(item({ pageId: 'new-page', name: 'ラップ' }));
    handleMessage(textEvent('ラップ'));
    expect(InventoryService.create).toHaveBeenCalledWith({ name: 'ラップ' });
    expect(SessionStore.get('U1')).toEqual({ flow: 'attach_photo', step: 'wait', data: { pageId: 'new-page' } });
    expect(repliedMessages()).toHaveLength(3);
  });

  it('newセッション中の重複名はセッション維持で再入力を促す', () => {
    SessionStore.set('U1', { flow: 'new', step: 'name' });
    vi.mocked(InventoryService.create).mockImplementation(() => { throw new Error('DUPLICATE_ITEM'); });
    handleMessage(textEvent('米'));
    expect(SessionStore.get('U1')).toEqual({ flow: 'new', step: 'name' });
    expect((repliedMessages()[0] as { text: string }).text).toContain('すでにあります');
  });

  it('edit/nameセッションで名前を変更してセッション終了', () => {
    SessionStore.set('U1', { flow: 'edit', step: 'name', data: { pageId: 'page-1' } });
    handleMessage(textEvent('無洗米'));
    expect(InventoryService.updateName).toHaveBeenCalledWith('page-1', '無洗米');
    expect(SessionStore.get('U1')).toBeNull();
  });

  it('edit/storesセッションで区切り文字を分解して全置換', () => {
    SessionStore.set('U1', { flow: 'edit', step: 'stores', data: { pageId: 'page-1' } });
    handleMessage(textEvent('スーパー / Amazon、ドラッグストア'));
    expect(InventoryService.updateStores).toHaveBeenCalledWith('page-1', ['スーパー', 'Amazon', 'ドラッグストア']);
    expect(SessionStore.get('U1')).toBeNull();
  });

  it('attach_photoセッション中のテキストは写真を促してセッション維持', () => {
    SessionStore.set('U1', { flow: 'attach_photo', step: 'wait', data: { pageId: 'page-1' } });
    handleMessage(textEvent('あとで'));
    expect((repliedMessages()[0] as { text: string }).text).toContain('写真');
    expect(SessionStore.get('U1')).not.toBeNull();
  });

  it('セッションなしのコマンドはrouteCommand経由で処理される', () => {
    vi.mocked(InventoryService.listShortage).mockReturnValue([]);
    handleMessage(textEvent('不足'));
    expect((repliedMessages()[0] as { text: string }).text).toContain('不足はありません');
  });
});
