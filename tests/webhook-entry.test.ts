import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installContentService } from './helpers/gasMocks';
import { verifySignature } from '../src/utils/signature';

vi.mock('../src/handlers/messageHandler', () => ({ handleMessage: vi.fn() }));
vi.mock('../src/handlers/postbackHandler', () => ({ handlePostback: vi.fn() }));
vi.mock('../src/handlers/followHandler', () => ({ handleFollow: vi.fn(), handleUnfollow: vi.fn() }));

import { handleMessage } from '../src/handlers/messageHandler';
import { handlePostback } from '../src/handlers/postbackHandler';
import { handleFollow, handleUnfollow } from '../src/handlers/followHandler';
import { doPost, doGet } from '../src/main';

const postEvent = (contents: string): GoogleAppsScript.Events.DoPost =>
  ({ postData: { contents } }) as unknown as GoogleAppsScript.Events.DoPost;

describe('verifySignature', () => {
  it('正常なWebhookボディでtrue', () => {
    expect(verifySignature(postEvent('{"destination":"xxx","events":[]}'))).toBe(true);
  });

  it('postDataなし・非JSON・events非配列でfalse', () => {
    expect(verifySignature(undefined)).toBe(false);
    expect(verifySignature({} as GoogleAppsScript.Events.DoPost)).toBe(false);
    expect(verifySignature(postEvent('not-json'))).toBe(false);
    expect(verifySignature(postEvent('{"events":"x"}'))).toBe(false);
  });
});

describe('doPost', () => {
  beforeEach(() => {
    installContentService();
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('イベント種別ごとにハンドラへ振り分ける', () => {
    const body = JSON.stringify({
      events: [
        { type: 'message', source: {} },
        { type: 'postback', source: {} },
        { type: 'follow', source: {} },
        { type: 'unfollow', source: {} },
        { type: 'unknown', source: {} },
      ],
    });
    const res = doPost(postEvent(body)) as unknown as { getContent: () => string };
    expect(res.getContent()).toBe('OK');
    expect(handleMessage).toHaveBeenCalledTimes(1);
    expect(handlePostback).toHaveBeenCalledTimes(1);
    expect(handleFollow).toHaveBeenCalledTimes(1);
    expect(handleUnfollow).toHaveBeenCalledTimes(1);
  });

  it('1イベントの例外が他イベントの処理を止めない', () => {
    vi.mocked(handleMessage).mockImplementation(() => { throw new Error('boom'); });
    const body = JSON.stringify({
      events: [
        { type: 'message', source: {} },
        { type: 'follow', source: {} },
      ],
    });
    const res = doPost(postEvent(body)) as unknown as { getContent: () => string };
    expect(res.getContent()).toBe('OK');
    expect(handleFollow).toHaveBeenCalledTimes(1);
  });

  it('不正ボディはinvalid signatureを返す', () => {
    const res = doPost(postEvent('broken')) as unknown as { getContent: () => string };
    expect(res.getContent()).toBe('invalid signature');
  });

  it('doGetが稼働メッセージを返す', () => {
    const res = doGet() as unknown as { getContent: () => string };
    expect(res.getContent()).toBe('LINE Inventory Bot is running.');
  });
});
