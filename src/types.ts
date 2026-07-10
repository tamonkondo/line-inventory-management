/** アプリ全体で共有するドメイン型(契約: docs/implementation/00-plan.md §5.1) */

export interface InventoryItem {
  pageId: string;                 // NotionページID
  name: string;                   // 品名
  inStock: boolean;               // 在庫あり=true / 在庫切れ=false
  category: string | null;        // カテゴリ(Select名)
  photoUrl: string | null;        // 写真1枚目のURL(なければnull)
  stores: string[];               // 購入先(Multi-select名の配列)
  location: string | null;        // 保管場所
  expiryDate: string | null;      // 'YYYY-MM-DD'
  lastPurchasedAt: string | null; // 'YYYY-MM-DD'(Rollup由来)
}

export interface User {
  pageId: string;
  name: string;
  lineUserId: string;
  active: boolean;
}

export interface Purchase {
  pageId: string;
  itemPageId: string | null;
  purchasedAt: string | null; // 'YYYY-MM-DD'
  store: string | null;
}

/** LINEへ返すメッセージ(必要最小限の自前型) */
export type LineMessage =
  | { type: 'text'; text: string }
  | { type: 'flex'; altText: string; contents: Record<string, unknown> };

/** LINE Webhookイベント(必要フィールドのみの自前型) */
export interface LineWebhookEvent {
  type: string;
  replyToken?: string;
  source: { userId?: string };
  message?: { id: string; type: string; text?: string };
  postback?: { data: string };
}

/** 会話セッション状態 */
export type SessionState =
  | { flow: 'new'; step: 'name' }
  | { flow: 'edit'; step: 'name' | 'stores'; data: { pageId: string } }
  | { flow: 'attach_photo'; step: 'wait'; data: { pageId: string } };

/** ルーター/ハンドラ共通のコンテキスト */
export interface CommandContext {
  lineUserId: string;
}
