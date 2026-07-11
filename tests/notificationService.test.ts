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

const item = (stores: string[] = [], photoUrl: string | null = null): InventoryItem => ({
  pageId: 'item-1', notionUrl: 'https://www.notion.so/item1', name: 'トイレットペーパー', inStock: false, category: null, photoUrl,
  stores, memo: null, lastPurchasedAt: null,
});

const user = (lineUserId: string): User => ({ pageId: `p-${lineUserId}`, name: lineUserId, lineUserId, active: true });

beforeEach(() => {
  // mockImplementationのテスト間リークを防ぐためresetを使う(clearは実装を残す)
  vi.resetAllMocks();
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

  it('写真(https)があれば本文と別便で画像を送る(R-12)', () => {
    vi.mocked(UserService.listActive).mockReturnValue([user('U2')]);
    NotificationService.notifyOutOfStock(item([], 'https://img/photo.jpg'), 'U1');
    const calls = vi.mocked(LineClient.multicast).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1][0].type).toBe('text');
    expect(calls[1][1][0]).toEqual({
      type: 'image',
      originalContentUrl: 'https://img/photo.jpg',
      previewImageUrl: 'https://img/photo.jpg',
    });
  });

  it('https以外の写真URLは添付しない(本文のみ1便)', () => {
    vi.mocked(UserService.listActive).mockReturnValue([user('U2')]);
    NotificationService.notifyOutOfStock(item([], 'http://insecure/photo.jpg'), 'U1');
    expect(LineClient.multicast).toHaveBeenCalledTimes(1);
  });

  it('写真の送信失敗は本文の配信に影響しない(ベストエフォート)', () => {
    vi.mocked(UserService.listActive).mockReturnValue([user('U2')]);
    vi.mocked(LineClient.multicast)
      .mockImplementationOnce(() => undefined) // 本文: 成功
      .mockImplementationOnce(() => { throw new Error('LINE API error: 400'); }); // 写真: 失敗
    expect(() => NotificationService.notifyOutOfStock(item([], 'https://img/photo.jpg'), 'U1')).not.toThrow();
    expect(LineClient.multicast).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalled();
  });

  it('送信時に対象者数がログに残る(可観測性)', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(UserService.listActive).mockReturnValue([user('U2'), user('U3')]);
    NotificationService.notifyOutOfStock(item(), 'U1');
    expect(logSpy.mock.calls.some((call) => String(call[0]).includes('2 user(s)'))).toBe(true);
  });
});

describe('NotificationService.notifyRestocked (R-11)', () => {
  it('報告者を除く有効ユーザーへ補充通知を送る(写真は別便)', () => {
    vi.mocked(UserService.listActive).mockReturnValue([user('U1'), user('U2')]);
    NotificationService.notifyRestocked(item([], 'https://img/photo.jpg'), 'U1');
    const calls = vi.mocked(LineClient.multicast).mock.calls;
    expect(calls[0][0]).toEqual(['U2']);
    expect((calls[0][1][0] as { text: string }).text).toContain('【補充】トイレットペーパー');
    expect(calls[1][1][0].type).toBe('image');
  });

  it('対象0人(報告者のみ)ならmulticastしない', () => {
    vi.mocked(UserService.listActive).mockReturnValue([user('U1')]);
    NotificationService.notifyRestocked(item(), 'U1');
    expect(LineClient.multicast).not.toHaveBeenCalled();
  });

  it('通知失敗でも例外を上に漏らさない', () => {
    vi.mocked(UserService.listActive).mockImplementation(() => { throw new Error('Notion API error: 500'); });
    expect(() => NotificationService.notifyRestocked(item(), 'U1')).not.toThrow();
  });
});
