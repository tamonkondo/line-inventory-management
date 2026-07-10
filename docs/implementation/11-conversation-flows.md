# 実装書(11): 会話フロー — セッション管理・postback/messageハンドラ

- **依存**: 07, 08, 09, 10, 12
- **対象ファイル**: `src/utils/sessionStore.ts`(**新規**)、`src/handlers/postbackHandler.ts`(新規)、`src/handlers/messageHandler.ts`(新規)。旧 `.js` 2ファイルを削除

## 目的

リッチメニュー・ボタン起点のステップ入力(選ぶ→実行)と、複数ターンにまたがる入力(新規登録の品名待ち、編集の値待ち、写真待ち)を実現する。

## 1. `src/utils/sessionStore.ts`(新規)

CacheService(スクリプトキャッシュ)でユーザーごとの会話状態を保持する。

```ts
import type { SessionState } from '../types';

const TTL_SECONDS = 300;
const key = (userId: string): string => `session:${userId}`;

/** ユーザーごとの会話状態(TTL 300秒)。 */
export const SessionStore = {
  get(userId: string): SessionState | null {
    const raw = CacheService.getScriptCache().get(key(userId));
    return raw ? (JSON.parse(raw) as SessionState) : null;
  },
  set(userId: string, state: SessionState): void {
    CacheService.getScriptCache().put(key(userId), JSON.stringify(state), TTL_SECONDS);
  },
  clear(userId: string): void {
    CacheService.getScriptCache().remove(key(userId));
  },
};
```

- キャッシュは揮発性。消えていたら「最初からやり直してください」と案内すれば復帰できる設計にする(状態消失を致命傷にしない)。

## 2. postback data 仕様(全アクション一覧)

形式はクエリ文字列。パーサーは postbackHandler 内の非export関数:

```ts
const parsePostbackData = (data: string): Record<string, string> =>
  Object.fromEntries(
    data.split('&').map((pair) => {
      const [k, v = ''] = pair.split('=');
      return [decodeURIComponent(k), decodeURIComponent(v)];
    }),
  );
```

| data | 発生元 | 動作 |
| --- | --- | --- |
| `action=list` | リッチメニュー | 在庫一覧(routeCommandの`list`相当) |
| `action=shortage` | リッチメニュー | 不足一覧 |
| `action=out&step=start` | リッチメニュー | 在庫ありの品目の選択リスト提示 |
| `action=out&step=pick&id=<pageId>` | 選択リスト | 在庫切れ化+通知+確認reply(`executeOut`) |
| `action=buy&step=start` | リッチメニュー | 在庫切れ品目の選択リスト提示(0件なら全品目) |
| `action=buy&step=pick&id=<pageId>` | 選択リスト | 在庫あり化+購入記録+確認reply(`executeBuy`) |
| `action=new&step=start` | リッチメニュー | セッション`{flow:'new',step:'name'}`→「品名を送ってください」 |
| `action=help` | リッチメニュー | ヘルプ表示 |
| `action=detail&id=<pageId>` | 一覧カード | 品目詳細カード(+直近履歴3件) |
| `action=history&id=<pageId>` | 詳細カード | 購入履歴表示 |
| `action=edit&step=menu&id=<pageId>` | 詳細カード | 編集メニュー(名前/購入先/写真) |
| `action=edit&step=field&field=name&id=<pageId>` | 編集メニュー | セッション`{flow:'edit',step:'name',data:{pageId}}`→「新しい名前を送ってください」 |
| `action=edit&step=field&field=stores&id=<pageId>` | 編集メニュー | セッション`{flow:'edit',step:'stores',data:{pageId}}`→「購入先を「スーパー / Amazon」のように送ってください(全置換)」 |
| `action=edit&step=field&field=photo&id=<pageId>` | 編集メニュー | セッション`{flow:'attach_photo',step:'wait',data:{pageId}}`→「写真を送ってください」 |
| `action=cancel` | 各種 | セッションclear→「キャンセルしました」 |

## 3. `src/handlers/postbackHandler.ts`

```ts
import { LineClient } from '../clients/lineClient';
import { logError } from '../utils/logger';
import type { LineMessage, LineWebhookEvent } from '../types';

export const handlePostback = (event: LineWebhookEvent): void => {
  const userId = event.source.userId;
  if (!userId || !event.replyToken || !event.postback) return;
  const data = parsePostbackData(event.postback.data);
  const messages = executePostback(data, { lineUserId: userId }); // 上表のswitch(非export)
  if (messages.length > 0) LineClient.reply(event.replyToken, messages);
};
```

実装上の注意:

- `out&step=pick` / `buy&step=pick` の実処理は **`executeOut` / `executeBuy`(実装書10でexport済み)を呼ぶ**。二重実装しない。
- 新しいアクション追加が1箇所で済むよう、`executePostback` は素直なswitch(または actionごとの分岐)にする。
- 不明な action は `logError` + 「操作をやり直してください」reply。

## 4. `src/handlers/messageHandler.ts`

```ts
import { LineClient } from '../clients/lineClient';
import { SessionStore } from '../utils/sessionStore';
import { routeCommand } from '../router/commandRouter';
import { handleImageMessage } from './imageHandler';
import type { CommandContext, LineMessage, LineWebhookEvent, SessionState } from '../types';

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

  const text = message.text;
  const context: CommandContext = { lineUserId: userId };

  // 3. 「キャンセル」は常にセッション破棄
  if (text.trim() === 'キャンセル') {
    SessionStore.clear(userId);
    LineClient.reply(event.replyToken, [{ type: 'text', text: 'キャンセルしました。' }]);
    return;
  }

  // 4. セッション継続中ならフロー側で処理
  const session = SessionStore.get(userId);
  if (session) {
    LineClient.reply(event.replyToken, handleSessionText(session, text, context));
    return;
  }

  // 5. コマンド解釈 / 6. コマンドでなければ短いフォールバック
  const messages = routeCommand(text, context) ?? [{
    type: 'text' as const,
    text: 'コマンドが分かりませんでした。「ヘルプ」と送るか、下のメニューから操作してください。',
  }];
  LineClient.reply(event.replyToken, messages);
};
```

### 4.1 `handleSessionText(session, text, context)`(非export)

| flow / step | 入力textの処理 |
| --- | --- |
| `new` / `name` | `InventoryService.create({ name: text.trim() })`。重複なら「すでにあります。別の名前を送るか「キャンセル」してください」(セッション維持)。成功→セッションを `{ flow: 'attach_photo', step: 'wait', data: { pageId } }` に差し替え、「登録しました。続けて写真を送ると登録できます(不要なら「キャンセル」)」+品目カード |
| `edit` / `name` | `InventoryService.updateName(pageId, text.trim())`。重複エラーは同上。成功→clear+「名前を変更しました」 |
| `edit` / `stores` | `text.split(/[/、,・]/)` → `map((s) => s.trim())` → 空要素除去 → `updateStores`。成功→clear+「購入先を更新しました: A / B」 |
| `attach_photo` / `wait` | テキストが来た場合:「写真(画像)を送ってください。やめる場合は「キャンセル」」(セッション維持) |
| 不明なflow | clear+フォールバック文言(壊れた状態からの自動復帰)。TSのnever網羅チェックを活かすが、実行時の不正JSONにも耐えること |

## 5. 受け入れ基準

- [ ] リッチメニュー6ボタン相当のpostbackがすべて動く(実機)。
- [ ] 「なくなった」ボタン→リスト→品目タップ→在庫切れ+通知、が完走する。
- [ ] 「新規登録」ボタン→品名送信→登録→写真送信→カードに写真が付く、が完走する。
- [ ] 途中で「キャンセル」するとどのフローも中断できる。
- [ ] セッションTTL(5分)経過後の入力が通常コマンドとして扱われる。
- [ ] `out`/`buy` の実処理が `executeOut`/`executeBuy` の呼び出しに一本化されている(コピペ二重実装がない)。
- [ ] `npm run typecheck` が通る。

## 6. 動作確認方法

実装書15のE2Eチェックリストで確認する(このタスク単体では、`executePostback({ action: 'list' }, { lineUserId: 'test' })` がメッセージ配列を返すことをログで確認)。
