import { LineClient } from '../clients/lineClient';
import { InventoryService } from '../services/inventoryService';
import { FlexBuilder } from '../messages/flexBuilder';
import { SessionStore } from '../utils/sessionStore';
import { routeCommand } from '../router/commandRouter';
import { handleImageMessage } from './imageHandler';
import type { CommandContext, LineMessage, LineWebhookEvent, SessionState } from '../types';

const text = (body: string): LineMessage => ({ type: 'text', text: body });

const FALLBACK_MESSAGE = 'コマンドが分かりませんでした。「ヘルプ」と送るか、下のメニューから操作してください。';

const isDuplicateError = (err: unknown): boolean =>
  err instanceof Error && err.message === 'DUPLICATE_ITEM';

/** セッション継続中のテキスト入力を処理する */
const handleSessionText = (session: SessionState, input: string, context: CommandContext): LineMessage[] => {
  const value = input.trim();

  if (session.flow === 'new' && session.step === 'name') {
    try {
      const item = InventoryService.create({ name: value });
      SessionStore.set(context.lineUserId, { flow: 'attach_photo', step: 'wait', data: { pageId: item.pageId } });
      return [
        text(`「${item.name}」を登録しました。`),
        FlexBuilder.buildItemCard(item),
        text('続けて写真を送ると登録できます(不要なら「キャンセル」)。'),
      ];
    } catch (err) {
      if (isDuplicateError(err)) {
        // セッション維持: 別の名前で再入力できる
        return [text(`「${value}」はすでにあります。別の名前を送るか「キャンセル」してください。`)];
      }
      throw err;
    }
  }

  if (session.flow === 'edit' && session.step === 'name') {
    try {
      InventoryService.updateName(session.data.pageId, value);
      SessionStore.clear(context.lineUserId);
      return [text(`名前を「${value}」に変更しました。`)];
    } catch (err) {
      if (isDuplicateError(err)) {
        return [text(`「${value}」はすでにあります。別の名前を送るか「キャンセル」してください。`)];
      }
      throw err;
    }
  }

  if (session.flow === 'edit' && session.step === 'stores') {
    const stores = value.split(/[/、,・]/).map((store) => store.trim()).filter((store) => store.length > 0);
    if (stores.length === 0) {
      return [text('購入先を「スーパー / Amazon」のように送ってください(やめる場合は「キャンセル」)。')];
    }
    InventoryService.updateStores(session.data.pageId, stores);
    SessionStore.clear(context.lineUserId);
    return [text(`購入先を更新しました: ${stores.join(' / ')}`)];
  }

  if (session.flow === 'attach_photo') {
    // テキストが来た場合は写真を促す(セッション維持)
    return [text('写真(画像)を送ってください。やめる場合は「キャンセル」と送ってください。')];
  }

  // 不正・未知の状態からの自動復帰
  SessionStore.clear(context.lineUserId);
  return [text(FALLBACK_MESSAGE)];
};

/** テキスト/画像メッセージイベントを処理する。 */
export const handleMessage = (event: LineWebhookEvent): void => {
  const userId = event.source.userId;
  const message = event.message;
  if (!userId || !event.replyToken || !message) return;

  // 1. 画像メッセージ → 写真フロー(実装書13)
  if (message.type === 'image') {
    handleImageMessage(event);
    return;
  }
  // 2. テキスト以外(スタンプ等)は無視
  if (message.type !== 'text' || message.text === undefined) return;

  const input = message.text;
  const context: CommandContext = { lineUserId: userId };

  // 3. 「キャンセル」は常にセッション破棄
  if (input.trim() === 'キャンセル') {
    SessionStore.clear(userId);
    LineClient.reply(event.replyToken, [text('キャンセルしました。')]);
    return;
  }

  // 4. セッション継続中ならフロー側で処理
  const session = SessionStore.get(userId);
  if (session) {
    LineClient.reply(event.replyToken, handleSessionText(session, input, context));
    return;
  }

  // 5. コマンド解釈 / 6. コマンドでなければ短いフォールバック
  const messages = routeCommand(input, context) ?? [text(FALLBACK_MESSAGE)];
  LineClient.reply(event.replyToken, messages);
};
