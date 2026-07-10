import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/clients/lineClient', () => ({
  LineClient: { multicast: vi.fn() },
}));
vi.mock('../src/services/userService', () => ({
  UserService: { listActive: vi.fn() },
}));

import { LineClient } from '../src/clients/lineClient';
import { UserService } from '../src/services/userService';
import { NotificationService } from '../src/services/notificationService';
import type { InventoryItem, User } from '../src/types';

const item = (stores: string[] = []): InventoryItem => ({
  pageId: 'item-1', name: 'トイレットペーパー', inStock: false, category: null, photoUrl: null,
  stores, lastPurchasedAt: null,
});

const user = (lineUserId: string): User => ({ pageId: `p-${lineUserId}`, name: lineUserId, lineUserId, active: true });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('NotificationService.notifyOutOfStock', () => {
  it('報告者を除いた有効ユーザーへmulticastする', () => {
    vi.mocked(UserService.listActive).mockReturnValue([user('U1'), user('U2'), user('U3')]);
    NotificationService.notifyOutOfStock(item(), 'U1');
    const [targets, messages] = vi.mocked(LineClient.multicast).mock.calls[0];
    expect(targets).toEqual(['U2', 'U3']);
    expect((messages[0] as { text: string }).text).toContain('【在庫切れ】トイレットペーパー');
    expect((messages[0] as { text: string }).text).toContain('買った トイレットペーパー');
  });

  it('購入先があれば文言に含める', () => {
    vi.mocked(UserService.listActive).mockReturnValue([user('U2')]);
    NotificationService.notifyOutOfStock(item(['スーパー', 'Amazon']), 'U1');
    const [, messages] = vi.mocked(LineClient.multicast).mock.calls[0];
    expect((messages[0] as { text: string }).text).toContain('購入先: スーパー / Amazon');
  });

  it('対象0人(報告者のみ)ならmulticastしない', () => {
    vi.mocked(UserService.listActive).mockReturnValue([user('U1')]);
    NotificationService.notifyOutOfStock(item(), 'U1');
    expect(LineClient.multicast).not.toHaveBeenCalled();
  });

  it('listActive(Notion障害)の失敗でも例外を上に漏らさない', () => {
    vi.mocked(UserService.listActive).mockImplementation(() => { throw new Error('Notion API error: 500'); });
    expect(() => NotificationService.notifyOutOfStock(item(), 'U1')).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });

  it('multicast失敗でも例外を上に漏らさない', () => {
    vi.mocked(UserService.listActive).mockReturnValue([user('U2')]);
    vi.mocked(LineClient.multicast).mockImplementation(() => { throw new Error('LINE API error: 500'); });
    expect(() => NotificationService.notifyOutOfStock(item(), 'U1')).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});
