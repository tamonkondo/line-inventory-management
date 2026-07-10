import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installProperties, installUtilities } from './helpers/gasMocks';

vi.mock('../src/clients/notionClient', () => ({
  NotionClient: {
    queryDatabase: vi.fn(),
    queryAll: vi.fn(),
    createPage: vi.fn(),
    updatePage: vi.fn(),
  },
}));
vi.mock('../src/clients/lineClient', () => ({
  LineClient: { getProfile: vi.fn(), reply: vi.fn() },
}));

import { NotionClient, type NotionPage } from '../src/clients/notionClient';
import { LineClient } from '../src/clients/lineClient';
import { UserService } from '../src/services/userService';
import { handleFollow, handleUnfollow } from '../src/handlers/followHandler';

const userPage = (id: string, name: string, lineUserId: string, status: string): NotionPage => ({
  id,
  properties: {
    '表示名': { type: 'title', title: [{ plain_text: name }] },
    'LINE User ID': { type: 'rich_text', rich_text: [{ plain_text: lineUserId }] },
    'ステータス': { type: 'select', select: { name: status } },
  },
});

const emptyQuery = { results: [], has_more: false, next_cursor: null };

beforeEach(() => {
  vi.clearAllMocks();
  installProperties({ NOTION_USERS_DB_ID: 'users-db' });
  installUtilities('2026-07-10');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('UserService.register', () => {
  it('未登録なら表示名を取得してページを作成する', () => {
    vi.mocked(NotionClient.queryDatabase).mockReturnValue(emptyQuery);
    vi.mocked(LineClient.getProfile).mockReturnValue({ displayName: '太郎', userId: 'U1' });
    vi.mocked(NotionClient.createPage).mockReturnValue(userPage('u-page', '太郎', 'U1', '有効'));

    const user = UserService.register('U1');
    expect(user).toEqual({ pageId: 'u-page', name: '太郎', lineUserId: 'U1', active: true });
    const payload = vi.mocked(NotionClient.createPage).mock.calls[0][0] as {
      properties: Record<string, unknown>;
    };
    expect(payload.properties['ステータス']).toEqual({ select: { name: '有効' } });
    expect(payload.properties['登録日']).toEqual({ date: { start: '2026-07-10' } });
  });

  it('既存ユーザーは再有効化のみでページを増やさない', () => {
    vi.mocked(NotionClient.queryDatabase).mockReturnValue({
      results: [userPage('u-page', '太郎', 'U1', '無効')], has_more: false, next_cursor: null,
    });
    const user = UserService.register('U1');
    expect(user.active).toBe(true);
    expect(NotionClient.createPage).not.toHaveBeenCalled();
    expect(NotionClient.updatePage).toHaveBeenCalledWith('u-page', {
      properties: { 'ステータス': { select: { name: '有効' } } },
    });
  });

  it('getProfile失敗でも(不明)で登録を続行する', () => {
    vi.mocked(NotionClient.queryDatabase).mockReturnValue(emptyQuery);
    vi.mocked(LineClient.getProfile).mockImplementation(() => { throw new Error('403'); });
    vi.mocked(NotionClient.createPage).mockReturnValue(userPage('u-page', '(不明)', 'U1', '有効'));

    const user = UserService.register('U1');
    expect(user.name).toBe('(不明)');
    const payload = vi.mocked(NotionClient.createPage).mock.calls[0][0] as {
      properties: Record<string, { title?: Array<{ text: { content: string } }> }>;
    };
    expect(payload.properties['表示名'].title?.[0].text.content).toBe('(不明)');
  });
});

describe('UserService.deactivate / listActive', () => {
  it('未登録ユーザーのdeactivateは何もしない', () => {
    vi.mocked(NotionClient.queryDatabase).mockReturnValue(emptyQuery);
    UserService.deactivate('U-unknown');
    expect(NotionClient.updatePage).not.toHaveBeenCalled();
  });

  it('登録済みユーザーを無効化する', () => {
    vi.mocked(NotionClient.queryDatabase).mockReturnValue({
      results: [userPage('u-page', '太郎', 'U1', '有効')], has_more: false, next_cursor: null,
    });
    UserService.deactivate('U1');
    expect(NotionClient.updatePage).toHaveBeenCalledWith('u-page', {
      properties: { 'ステータス': { select: { name: '無効' } } },
    });
  });

  it('listActiveが有効フィルタで問い合わせる', () => {
    vi.mocked(NotionClient.queryAll).mockReturnValue([userPage('u1', 'A', 'U1', '有効')]);
    const users = UserService.listActive();
    expect(users).toHaveLength(1);
    expect(vi.mocked(NotionClient.queryAll).mock.calls[0][1]).toEqual({
      filter: { property: 'ステータス', select: { equals: '有効' } },
    });
  });
});

describe('followHandler', () => {
  it('followで登録してあいさつを返信する', () => {
    vi.mocked(NotionClient.queryDatabase).mockReturnValue(emptyQuery);
    vi.mocked(LineClient.getProfile).mockReturnValue({ displayName: '太郎', userId: 'U1' });
    vi.mocked(NotionClient.createPage).mockReturnValue(userPage('u-page', '太郎', 'U1', '有効'));

    handleFollow({ type: 'follow', replyToken: 'rt', source: { userId: 'U1' } });
    const [token, messages] = vi.mocked(LineClient.reply).mock.calls[0];
    expect(token).toBe('rt');
    expect(messages[0].type).toBe('text');
    expect((messages[0] as { text: string }).text).toContain('太郎さん');
  });

  it('userIdのないsourceでは何もしない', () => {
    handleFollow({ type: 'follow', replyToken: 'rt', source: {} });
    handleUnfollow({ type: 'unfollow', source: {} });
    expect(NotionClient.queryDatabase).not.toHaveBeenCalled();
    expect(LineClient.reply).not.toHaveBeenCalled();
  });

  it('unfollowで無効化する(返信しない)', () => {
    vi.mocked(NotionClient.queryDatabase).mockReturnValue({
      results: [userPage('u-page', '太郎', 'U1', '有効')], has_more: false, next_cursor: null,
    });
    handleUnfollow({ type: 'unfollow', source: { userId: 'U1' } });
    expect(NotionClient.updatePage).toHaveBeenCalled();
    expect(LineClient.reply).not.toHaveBeenCalled();
  });
});
