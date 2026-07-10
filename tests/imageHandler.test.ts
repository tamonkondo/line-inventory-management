import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installCache, installUtilities, makeBlob } from './helpers/gasMocks';

vi.mock('../src/clients/lineClient', () => ({
  LineClient: { reply: vi.fn(), getMessageContent: vi.fn() },
}));
vi.mock('../src/clients/notionClient', () => ({
  NotionClient: { uploadFile: vi.fn() },
}));
vi.mock('../src/services/inventoryService', () => ({
  InventoryService: { attachPhoto: vi.fn(), getByPageId: vi.fn() },
}));

import { LineClient } from '../src/clients/lineClient';
import { NotionClient } from '../src/clients/notionClient';
import { InventoryService } from '../src/services/inventoryService';
import { SessionStore } from '../src/utils/sessionStore';
import { handleImageMessage } from '../src/handlers/imageHandler';
import type { InventoryItem, LineWebhookEvent } from '../src/types';

const imageEvent: LineWebhookEvent = {
  type: 'message', replyToken: 'rt', source: { userId: 'U1' }, message: { id: 'msg-1', type: 'image' },
};

const item: InventoryItem = {
  pageId: 'page-1', name: 'ラップ', inStock: true, category: null, photoUrl: null,
  stores: [], location: null, expiryDate: null, lastPurchasedAt: null,
};

const lastReplyText = (): string => {
  const calls = vi.mocked(LineClient.reply).mock.calls;
  return (calls[calls.length - 1][1][0] as { text: string }).text;
};

beforeEach(() => {
  vi.clearAllMocks();
  installCache();
  installUtilities('2026-07-10');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('handleImageMessage', () => {
  it('attach_photoセッション中: 取得→アップロード→添付→セッション破棄', () => {
    SessionStore.set('U1', { flow: 'attach_photo', step: 'wait', data: { pageId: 'page-1' } });
    vi.mocked(LineClient.getMessageContent).mockReturnValue(
      makeBlob('bytes', 'image/jpeg') as unknown as GoogleAppsScript.Base.Blob,
    );
    vi.mocked(NotionClient.uploadFile).mockReturnValue('fu-1');
    vi.mocked(InventoryService.getByPageId).mockReturnValue(item);

    handleImageMessage(imageEvent);

    expect(LineClient.getMessageContent).toHaveBeenCalledWith('msg-1');
    const [, filename] = vi.mocked(NotionClient.uploadFile).mock.calls[0];
    expect(filename).toMatch(/^photo-\d{8}-\d{6}\.jpg$/);
    expect(InventoryService.attachPhoto).toHaveBeenCalledWith('page-1', 'fu-1', filename);
    expect(SessionStore.get('U1')).toBeNull();
    expect(lastReplyText()).toBe('ラップ に写真を登録しました 📷');
  });

  it('PNG画像は拡張子pngになる', () => {
    SessionStore.set('U1', { flow: 'attach_photo', step: 'wait', data: { pageId: 'page-1' } });
    vi.mocked(LineClient.getMessageContent).mockReturnValue(
      makeBlob('bytes', 'image/png') as unknown as GoogleAppsScript.Base.Blob,
    );
    vi.mocked(NotionClient.uploadFile).mockReturnValue('fu-1');
    vi.mocked(InventoryService.getByPageId).mockReturnValue(item);
    handleImageMessage(imageEvent);
    expect(vi.mocked(NotionClient.uploadFile).mock.calls[0][1]).toMatch(/\.png$/);
  });

  it('セッションなしなら操作案内のみ(アップロードしない)', () => {
    handleImageMessage(imageEvent);
    expect(NotionClient.uploadFile).not.toHaveBeenCalled();
    expect(lastReplyText()).toContain('「編集 品名」→「写真を変える」');
  });

  it('失敗時はセッション維持で再試行を案内する', () => {
    SessionStore.set('U1', { flow: 'attach_photo', step: 'wait', data: { pageId: 'page-1' } });
    vi.mocked(LineClient.getMessageContent).mockImplementation(() => { throw new Error('fetch failed'); });
    handleImageMessage(imageEvent);
    expect(SessionStore.get('U1')).not.toBeNull();
    expect(lastReplyText()).toContain('もう一度送るか');
  });

  it('登録成功後の名前取得失敗でも成功として報告する(偽の失敗メッセージを出さない)', () => {
    SessionStore.set('U1', { flow: 'attach_photo', step: 'wait', data: { pageId: 'page-1' } });
    vi.mocked(LineClient.getMessageContent).mockReturnValue(
      makeBlob('bytes', 'image/jpeg') as unknown as GoogleAppsScript.Base.Blob,
    );
    vi.mocked(NotionClient.uploadFile).mockReturnValue('fu-1');
    vi.mocked(InventoryService.getByPageId).mockReturnValue(null); // 取得失敗はnull契約

    handleImageMessage(imageEvent);
    expect(InventoryService.attachPhoto).toHaveBeenCalled();
    expect(SessionStore.get('U1')).toBeNull();
    expect(lastReplyText()).toBe('品目 に写真を登録しました 📷');
  });

  it('userIdなしイベントは無視する', () => {
    handleImageMessage({ type: 'message', source: {}, message: { id: 'm', type: 'image' } });
    expect(LineClient.reply).not.toHaveBeenCalled();
  });
});
