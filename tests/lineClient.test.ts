import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installProperties, installUrlFetch, installUtilities } from './helpers/gasMocks';
import { LineClient } from '../src/clients/lineClient';

describe('LineClient', () => {
  beforeEach(() => {
    installProperties({ LINE_CHANNEL_ACCESS_TOKEN: 'token-xyz' });
    installUtilities();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('replyが正しいURL・ペイロード・認証ヘッダで呼ぶ', () => {
    const { calls } = installUrlFetch([{ code: 200, body: '{}' }]);
    LineClient.reply('rt-1', [{ type: 'text', text: 'hi' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.line.me/v2/bot/message/reply');
    expect(calls[0].options.payload).toBe(JSON.stringify({ replyToken: 'rt-1', messages: [{ type: 'text', text: 'hi' }] }));
    expect((calls[0].options.headers as Record<string, string>).Authorization).toBe('Bearer token-xyz');
  });

  it('2xx以外で例外を投げる', () => {
    installUrlFetch([{ code: 400, body: '{"message":"bad"}' }]);
    expect(() => LineClient.push('U1', [{ type: 'text', text: 'x' }])).toThrow('LINE API error: 400');
  });

  it('multicastは空配列でAPIを呼ばない', () => {
    const { calls } = installUrlFetch();
    LineClient.multicast([], [{ type: 'text', text: 'x' }]);
    expect(calls).toHaveLength(0);
  });

  it('multicastがto配列を渡す', () => {
    const { calls } = installUrlFetch([{ code: 200, body: '{}' }]);
    LineClient.multicast(['U1', 'U2'], [{ type: 'text', text: 'x' }]);
    expect(JSON.parse(calls[0].options.payload as string).to).toEqual(['U1', 'U2']);
  });

  it('multicastは500件超を分割して送る', () => {
    const { calls } = installUrlFetch(Array.from({ length: 3 }, () => ({ code: 200, body: '{}' })));
    const userIds = Array.from({ length: 1001 }, (_, i) => `U${i}`);
    LineClient.multicast(userIds, [{ type: 'text', text: 'x' }]);
    expect(calls).toHaveLength(3);
    expect(JSON.parse(calls[0].options.payload as string).to).toHaveLength(500);
    expect(JSON.parse(calls[2].options.payload as string).to).toHaveLength(1);
  });

  it('pushは一時エラー(500)を1回リトライする', () => {
    const { calls } = installUrlFetch([
      { code: 500, body: 'transient' },
      { code: 200, body: '{}' },
    ]);
    LineClient.push('U1', [{ type: 'text', text: 'x' }]);
    expect(calls).toHaveLength(2);
  });

  it('replyはリトライしない(replyTokenは1回限り)', () => {
    const { calls } = installUrlFetch([{ code: 500, body: 'transient' }]);
    expect(() => LineClient.reply('rt', [{ type: 'text', text: 'x' }])).toThrow('LINE API error: 500');
    expect(calls).toHaveLength(1);
  });

  it('getProfileがプロフィールを返す', () => {
    installUrlFetch([{ code: 200, body: '{"displayName":"太郎","userId":"U1"}' }]);
    expect(LineClient.getProfile('U1').displayName).toBe('太郎');
  });

  it('getMessageContentがapi-dataホストを使いBlobを返す', () => {
    const { calls } = installUrlFetch([{ code: 200, body: 'binary' }]);
    const blob = LineClient.getMessageContent('msg-1');
    expect(calls[0].url).toBe('https://api-data.line.me/v2/bot/message/msg-1/content');
    expect(blob.getBytes().length).toBeGreaterThan(0);
  });

  it('getMessageContentが非200で例外', () => {
    installUrlFetch([{ code: 404, body: 'not found' }]);
    expect(() => LineClient.getMessageContent('msg-1')).toThrow('LINE content fetch failed: 404');
  });
});
