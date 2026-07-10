import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installProperties } from './helpers/gasMocks';
import { CONFIG, NOTION_PROPS, USER_STATUS } from '../src/config';
import { logInfo, logError } from '../src/utils/logger';

describe('CONFIG', () => {
  it('設定済みプロパティを返す', () => {
    installProperties({ NOTION_TOKEN: 'ntn_test' });
    expect(CONFIG.NOTION_TOKEN).toBe('ntn_test');
  });

  it('未設定プロパティで例外を投げる', () => {
    installProperties({});
    expect(() => CONFIG.LINE_CHANNEL_SECRET).toThrow('Missing script property: LINE_CHANNEL_SECRET');
  });
});

describe('NOTION_PROPS / USER_STATUS', () => {
  it('notion-schema.md のプロパティ名と一致する', () => {
    expect(NOTION_PROPS.INVENTORY.NAME).toBe('品名');
    expect(NOTION_PROPS.INVENTORY.IN_STOCK).toBe('在庫あり');
    expect(NOTION_PROPS.USERS.LINE_USER_ID).toBe('LINE User ID');
    expect(NOTION_PROPS.PURCHASES.PURCHASED_AT).toBe('購入日');
    expect(USER_STATUS.ACTIVE).toBe('有効');
    expect(USER_STATUS.INACTIVE).toBe('無効');
  });
});

describe('logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('logInfoが統一形式で出力する', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    logInfo('test', { a: 1 });
    expect(spy).toHaveBeenCalledWith('[INFO][test] {"a":1}');
  });

  it('logErrorがErrorのスタックを出力する', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logError('ctx', new Error('boom'));
    expect(spy.mock.calls[0][0]).toContain('[ERROR][ctx]');
    expect(spy.mock.calls[0][0]).toContain('boom');
  });

  it('logErrorが非Error値も文字列化する', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logError('ctx', { reason: 'x' });
    expect(spy).toHaveBeenCalledWith('[ERROR][ctx] {"reason":"x"}');
  });
});
