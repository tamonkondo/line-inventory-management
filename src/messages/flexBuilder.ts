import type { InventoryItem, LineMessage, Purchase } from '../types';

/**
 * 在庫情報のLINE Flexメッセージ組み立て(純粋な変換のみ)。
 * サービス・クライアントには依存しない。
 * postback data の文字列は docs/implementation/11 の表と一致させること。
 */

/** テキストメッセージの共通コンストラクタ(各ハンドラ・ルーターから共用) */
export const textMessage = (text: string): LineMessage => ({ type: 'text', text });

const MAX_ROWS = 20;
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

/** 外部URL(Notionの編集ページ等)を開くボタン */
const uriButton = (label: string, uri: string): FlexNode => ({
  type: 'button',
  style: 'secondary',
  height: 'sm',
  action: { type: 'uri', label, uri },
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

/** カテゴリ未設定の品目をまとめる枠の名前 */
const UNSET_CATEGORY = '未設定';

/** カテゴリのセクション見出し行 */
const categoryHeaderRow = (name: string, first: boolean): FlexNode => ({
  type: 'box',
  layout: 'vertical',
  margin: first ? 'none' : 'lg',
  contents: [
    { type: 'text', text: `📁 ${name}`, size: 'sm', weight: 'bold', color: '#555555' },
    { type: 'separator', margin: 'sm' },
  ],
});

/** 品目をカテゴリごとにまとめる。並びは入力順(Notionのカテゴリ順)を保ち、未設定は最後 */
const groupByCategory = (items: InventoryItem[]): Array<[string, InventoryItem[]]> => {
  const groups = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const key = item.category ?? UNSET_CATEGORY;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const entries = [...groups.entries()].filter(([name]) => name !== UNSET_CATEGORY);
  const unset = groups.get(UNSET_CATEGORY);
  if (unset) entries.push([UNSET_CATEGORY, unset]);
  return entries;
};

export const FlexBuilder = {
  /** 一覧(在庫一覧/不足一覧/検索結果)。カテゴリごとに見出しを付けて表示し、行タップで品目詳細へ */
  buildItemListMessage(title: string, items: InventoryItem[]): LineMessage {
    const rows: FlexNode[] = [];
    let shownCount = 0;
    for (const [category, groupItems] of groupByCategory(items)) {
      if (shownCount >= MAX_ROWS) break;
      rows.push(categoryHeaderRow(category, rows.length === 0));
      for (const item of groupItems) {
        if (shownCount >= MAX_ROWS) break;
        rows.push(itemRow(item, postbackAction(item.name, `action=detail&id=${encodeURIComponent(item.pageId)}`)));
        shownCount += 1;
      }
    }
    const hidden = items.length - shownCount;
    if (hidden > 0) rows.push(truncateFooter(hidden));

    const bubble: FlexNode = {
      type: 'bubble',
      header: headerBox(`${title}(${items.length}件)`),
      body: { type: 'box', layout: 'vertical', spacing: 'none', contents: rows },
    };
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
          uriButton('編集(Notion)', item.notionUrl), // 詳細編集はNotionページで行う(R-14)
          postbackButton('履歴', `action=history&id=${id}`),
        ],
      },
    };
    return { type: 'flex', altText: `${item.name}(${item.inStock ? '在庫あり' : '在庫切れ'})`, contents: bubble };
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
        '・編集 品名 … Notionの編集ページを開く\n' +
        '・キャンセル … 途中の操作をやめる\n\n' +
        '品目の詳しい編集はNotionで行えます。',
    };
  },
};
