import type { InventoryItem, LineMessage, Purchase } from '../types';

/**
 * 在庫情報のLINE Flexメッセージ組み立て(純粋な変換のみ)。
 * サービス・クライアントには依存しない。
 * postback data の文字列は docs/implementation/11 の表と一致させること。
 */

/** テキストメッセージの共通コンストラクタ(各ハンドラ・ルーターから共用) */
export const textMessage = (text: string): LineMessage => ({ type: 'text', text });

const MAX_ROWS = 20;
const MAX_OPTIONS = 12;
const COLOR_IN_STOCK = '#06C755';
const COLOR_OUT_OF_STOCK = '#E63946';

type FlexNode = Record<string, unknown>;

const statusText = (item: InventoryItem): FlexNode => ({
  type: 'text',
  text: item.inStock ? '✅ あり' : '❌ 切れ',
  color: item.inStock ? COLOR_IN_STOCK : COLOR_OUT_OF_STOCK,
  size: 'sm',
  align: 'end',
  flex: 0,
});

const postbackAction = (label: string, data: string, displayText?: string): FlexNode => ({
  type: 'postback',
  label,
  data,
  ...(displayText ? { displayText } : {}),
});

const postbackButton = (label: string, data: string, displayText?: string): FlexNode => ({
  type: 'button',
  style: 'secondary',
  height: 'sm',
  action: postbackAction(label, data, displayText),
});

const cancelButton = (): FlexNode => postbackButton('キャンセル', 'action=cancel', 'キャンセル');

const headerBox = (title: string): FlexNode => ({
  type: 'box',
  layout: 'vertical',
  contents: [{ type: 'text', text: title, weight: 'bold', size: 'lg' }],
});

const truncateFooter = (hiddenCount: number): FlexNode => ({
  type: 'text',
  text: `ほか ${hiddenCount} 件(検索や絞り込みを使ってください)`,
  size: 'xs',
  color: '#999999',
  wrap: true,
  margin: 'md',
});

/** httpsのURLのみサムネイルに使う(Flexの画像URL要件) */
const safePhotoUrl = (item: InventoryItem): string | null =>
  item.photoUrl && item.photoUrl.startsWith('https://') ? item.photoUrl : null;

const itemRow = (item: InventoryItem, action: FlexNode): FlexNode => ({
  type: 'box',
  layout: 'horizontal',
  paddingTop: 'sm',
  paddingBottom: 'sm',
  contents: [
    { type: 'text', text: item.name || '(名称未設定)', size: 'sm', flex: 1 },
    statusText(item),
  ],
  action,
});

const listBubble = (title: string, items: InventoryItem[], rowAction: (item: InventoryItem) => FlexNode): FlexNode => {
  const visible = items.slice(0, MAX_ROWS);
  const hidden = items.length - visible.length;
  const rows: FlexNode[] = visible.map((item) => itemRow(item, rowAction(item)));
  if (hidden > 0) rows.push(truncateFooter(hidden));
  return {
    type: 'bubble',
    header: headerBox(`${title}(${items.length}件)`),
    body: { type: 'box', layout: 'vertical', spacing: 'none', contents: rows },
  };
};

export const FlexBuilder = {
  /** 一覧(在庫一覧/不足一覧/検索結果)。行タップで品目詳細へ */
  buildItemListMessage(title: string, items: InventoryItem[]): LineMessage {
    const bubble = listBubble(title, items, (item) =>
      postbackAction(item.name, `action=detail&id=${encodeURIComponent(item.pageId)}`),
    );
    return { type: 'flex', altText: `${title}(${items.length}件)`, contents: bubble };
  },

  /** 品目選択リスト(なくなった/買った用)。行タップで実行 */
  buildPickListMessage(items: InventoryItem[], action: 'out' | 'buy'): LineMessage {
    const verb = action === 'out' ? 'なくなった' : '買った';
    const bubble = listBubble(`どれが${verb}?`, items, (item) =>
      postbackAction(
        item.name,
        `action=${action}&step=pick&id=${encodeURIComponent(item.pageId)}`,
        `${verb}: ${item.name}`,
      ),
    ) as FlexNode & { footer?: FlexNode };
    bubble.footer = { type: 'box', layout: 'vertical', contents: [cancelButton()] };
    return { type: 'flex', altText: `どれが${verb}?`, contents: bubble };
  },

  /** 品目詳細カード(purchasesを渡すと直近の購入日も表示) */
  buildItemCard(item: InventoryItem, purchases?: Purchase[]): LineMessage {
    const id = encodeURIComponent(item.pageId);
    const bodyContents: FlexNode[] = [
      { type: 'text', text: item.name || '(名称未設定)', weight: 'bold', size: 'xl', wrap: true },
      {
        type: 'box',
        layout: 'horizontal',
        margin: 'sm',
        contents: [{ type: 'text', text: '状態', size: 'sm', color: '#999999', flex: 0, margin: 'none' }, statusText(item)],
      },
    ];
    const infoRow = (label: string, value: string): FlexNode => ({
      type: 'box',
      layout: 'horizontal',
      margin: 'sm',
      contents: [
        { type: 'text', text: label, size: 'sm', color: '#999999', flex: 2 },
        { type: 'text', text: value, size: 'sm', flex: 5, wrap: true },
      ],
    });
    if (item.category) bodyContents.push(infoRow('カテゴリ', item.category));
    if (item.stores.length > 0) bodyContents.push(infoRow('購入先', item.stores.join(' / ')));
    if (item.memo) bodyContents.push(infoRow('メモ', item.memo));
    if (item.lastPurchasedAt) bodyContents.push(infoRow('最終購入', item.lastPurchasedAt));
    if (purchases && purchases.length > 0) {
      bodyContents.push({ type: 'text', text: '最近の購入', size: 'sm', color: '#999999', margin: 'md' });
      purchases.slice(0, 3).forEach((purchase) => {
        bodyContents.push({ type: 'text', text: `・${purchase.purchasedAt ?? '(日付不明)'}`, size: 'sm' });
      });
    }

    const photoUrl = safePhotoUrl(item);
    const bubble: FlexNode = {
      type: 'bubble',
      ...(photoUrl
        ? { hero: { type: 'image', url: photoUrl, size: 'full', aspectRatio: '4:3', aspectMode: 'cover' } }
        : {}),
      body: { type: 'box', layout: 'vertical', contents: bodyContents },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          item.inStock
            ? postbackButton('なくなった', `action=out&step=pick&id=${id}`, `なくなった: ${item.name}`)
            : postbackButton('買った', `action=buy&step=pick&id=${id}`, `買った: ${item.name}`),
          postbackButton('編集', `action=edit&step=menu&id=${id}`),
          postbackButton('履歴', `action=history&id=${id}`),
        ],
      },
    };
    return { type: 'flex', altText: `${item.name}(${item.inStock ? '在庫あり' : '在庫切れ'})`, contents: bubble };
  },

  /** 編集メニュー(名前/購入先/写真。それ以外の編集はNotionで: R-05) */
  buildEditMenuMessage(item: InventoryItem): LineMessage {
    const id = encodeURIComponent(item.pageId);
    const bubble: FlexNode = {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `${item.name} の何を変えますか?`, weight: 'bold', wrap: true },
          { type: 'text', text: 'その他の編集はNotionで行えます。', size: 'xs', color: '#999999', margin: 'sm', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          postbackButton('名前を変える', `action=edit&step=field&field=name&id=${id}`),
          postbackButton('購入先を変える', `action=edit&step=field&field=stores&id=${id}`),
          postbackButton('写真を変える', `action=edit&step=field&field=photo&id=${id}`),
          cancelButton(),
        ],
      },
    };
    return { type: 'flex', altText: `${item.name} の編集`, contents: bubble };
  },

  /**
   * Select/Multi-selectの選択肢ボタン一覧(新規登録フロー用: R-13)。
   * optionsは最大12件表示。selectedに含まれる項目は「✓ 」を付けて表示する。
   */
  buildOptionPickMessage(params: {
    title: string;
    options: string[];
    actionBase: string;                      // 例: 'action=new&step=category'(valueはビルダーが付与)
    selected?: string[];
    skip?: { label: string; data: string };  // 「スキップ」等
    done?: { label: string; data: string };  // 「決定」等(複数選択用)
  }): LineMessage {
    const { title, options, actionBase, selected = [], skip, done } = params;
    const visible = options.slice(0, MAX_OPTIONS);
    const hidden = options.length - visible.length;

    const bodyContents: FlexNode[] = [
      { type: 'text', text: title, weight: 'bold', wrap: true },
      { type: 'text', text: '選択肢の追加・変更はNotionで行えます。', size: 'xs', color: '#999999', margin: 'sm', wrap: true },
    ];
    if (selected.length > 0) {
      bodyContents.push({ type: 'text', text: `選択中: ${selected.join(' / ')}`, size: 'sm', margin: 'md', wrap: true });
    }
    if (hidden > 0) {
      bodyContents.push(truncateFooter(hidden));
    }

    const buttons: FlexNode[] = visible.map((name) =>
      postbackButton(
        `${selected.includes(name) ? '✓ ' : ''}${name}`,
        `${actionBase}&value=${encodeURIComponent(name)}`,
      ),
    );
    if (skip) buttons.push(postbackButton(skip.label, skip.data));
    if (done) buttons.push(postbackButton(done.label, done.data));
    buttons.push(cancelButton());

    const bubble: FlexNode = {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: bodyContents },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons },
    };
    return { type: 'flex', altText: title, contents: bubble };
  },

  /** ヘルプ(テキストで十分) */
  buildHelpMessage(): LineMessage {
    return {
      type: 'text',
      text:
        '📦 在庫管理Botの使い方\n\n' +
        '【メニュー or コマンド】\n' +
        '・在庫 … 在庫一覧\n' +
        '・不足 … 在庫切れの一覧\n' +
        '・なくなった 品名 … 在庫切れを報告(みんなに通知)\n' +
        '・買った 品名 … 在庫ありに戻して購入を記録\n' +
        '・新規 品名 … 品目を登録\n' +
        '・履歴 品名 … 購入履歴を見る\n' +
        '・検索 キーワード\n' +
        '・編集 品名 … 名前/購入先/写真を変更\n' +
        '・キャンセル … 途中の操作をやめる\n\n' +
        '品目の詳しい編集はNotionで行えます。',
    };
  },
};
