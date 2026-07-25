import { describe, it, expect } from 'vitest';
import { FlexBuilder } from '../src/messages/flexBuilder';
import type { InventoryItem, Purchase } from '../src/types';

const item = (overrides: Partial<InventoryItem> = {}): InventoryItem => ({
  pageId: 'page-1', notionUrl: 'https://www.notion.so/page1', name: '食器用洗剤', inStock: true, category: '洗剤',
  photoUrl: null, stores: ['スーパー'], memo: null,
  lastPurchasedAt: '2026-07-01', ...overrides,
});

type FlexNode = Record<string, any>;

const flatten = (node: unknown): FlexNode[] => {
  if (!node || typeof node !== 'object') return [];
  const record = node as FlexNode;
  const children = Array.isArray(record.contents) ? record.contents : [];
  return [record, ...children.flatMap(flatten), ...flatten(record.body), ...flatten(record.footer), ...flatten(record.header)];
};

const allPostbackData = (message: { contents: unknown }): string[] =>
  flatten(message.contents)
    .map((node) => (node.action as FlexNode | undefined)?.data ?? (node.type === 'postback' ? node.data : undefined))
    .filter((d): d is string => typeof d === 'string');

describe('buildItemListMessage', () => {
  it('altTextと件数、detailへのpostbackを含む', () => {
    const message = FlexBuilder.buildItemListMessage('在庫一覧', [item()]);
    expect(message.type).toBe('flex');
    if (message.type !== 'flex') return;
    expect(message.altText).toBe('在庫一覧(1件)');
    expect(allPostbackData(message)).toContain('action=detail&id=page-1');
  });

  it('21件以上は20行+「ほかN件」に切り詰める', () => {
    const items = Array.from({ length: 25 }, (_, i) => item({ pageId: `p${i}`, name: `品目${i}` }));
    const message = FlexBuilder.buildItemListMessage('在庫一覧', items);
    if (message.type !== 'flex') return;
    const texts = flatten(message.contents).map((n) => n.text).filter((t): t is string => typeof t === 'string');
    expect(texts.some((t) => t.includes('ほか 5 件'))).toBe(true);
    expect(allPostbackData(message)).toHaveLength(20);
  });

  it('カテゴリごとに見出しを付けて表示し、未設定は最後の枠にまとめる', () => {
    const items = [
      item({ pageId: 'a', name: '洗剤A', category: '洗剤' }),
      item({ pageId: 'b', name: '洗剤B', category: '洗剤' }),
      item({ pageId: 'c', name: '米', category: '食品' }),
      item({ pageId: 'd', name: '謎の品', category: null }),
    ];
    const message = FlexBuilder.buildItemListMessage('在庫一覧', items);
    if (message.type !== 'flex') return;
    const texts = flatten(message.contents).map((n) => n.text).filter((t): t is string => typeof t === 'string');
    const headers = texts.filter((t) => t.startsWith('📁 '));
    expect(headers).toEqual(['📁 洗剤', '📁 食品', '📁 未設定']); // 未設定が最後
    // 品目行も全件含まれる
    expect(texts).toContain('洗剤A');
    expect(texts).toContain('謎の品');
  });

  it('全品目がカテゴリ設定済みなら未設定の枠は出ない', () => {
    const message = FlexBuilder.buildItemListMessage('在庫一覧', [item({ category: '洗剤' })]);
    if (message.type !== 'flex') return;
    const texts = flatten(message.contents).map((n) => n.text).filter((t): t is string => typeof t === 'string');
    expect(texts).not.toContain('📁 未設定');
  });

  it('nullだらけの品目でも例外にならない', () => {
    const bare = item({ name: '', category: null, stores: [], photoUrl: null, lastPurchasedAt: null });
    expect(() => FlexBuilder.buildItemListMessage('在庫一覧', [bare])).not.toThrow();
  });
});

describe('buildPickListMessage', () => {
  it('pick用postbackとdisplayText、キャンセルボタンを含む', () => {
    const message = FlexBuilder.buildPickListMessage([item()], 'out');
    if (message.type !== 'flex') return;
    const data = allPostbackData(message);
    expect(data).toContain('action=out&step=pick&id=page-1');
    expect(data).toContain('action=cancel');
    const actions = flatten(message.contents).map((n) => n.action as FlexNode | undefined).filter(Boolean);
    expect(actions.some((a) => a!.displayText === 'なくなった: 食器用洗剤')).toBe(true);
  });

  it('buyアクションではbuyのdataになる', () => {
    const message = FlexBuilder.buildPickListMessage([item()], 'buy');
    if (message.type !== 'flex') return;
    expect(allPostbackData(message)).toContain('action=buy&step=pick&id=page-1');
  });
});

describe('buildItemCard', () => {
  it('在庫ありなら「なくなった」、在庫切れなら「買った」ボタン', () => {
    const inStock = FlexBuilder.buildItemCard(item());
    const outOfStock = FlexBuilder.buildItemCard(item({ inStock: false }));
    if (inStock.type !== 'flex' || outOfStock.type !== 'flex') return;
    expect(allPostbackData(inStock)).toContain('action=out&step=pick&id=page-1');
    expect(allPostbackData(outOfStock)).toContain('action=buy&step=pick&id=page-1');
    const uris = flatten(inStock.contents)
      .map((n) => n.action as FlexNode | undefined)
      .filter((a): a is FlexNode => a?.type === 'uri');
    expect(uris.some((a) => a.uri === 'https://www.notion.so/page1' && a.label === '編集(Notion)')).toBe(true);
    expect(allPostbackData(inStock)).toContain('action=history&id=page-1');
  });

  it('https写真はheroに、非httpsは載せない', () => {
    const withPhoto = FlexBuilder.buildItemCard(item({ photoUrl: 'https://img/x.jpg' }));
    const withBadPhoto = FlexBuilder.buildItemCard(item({ photoUrl: 'http://img/x.jpg' }));
    if (withPhoto.type !== 'flex' || withBadPhoto.type !== 'flex') return;
    expect((withPhoto.contents as FlexNode).hero).toBeDefined();
    expect((withBadPhoto.contents as FlexNode).hero).toBeUndefined();
  });

  it('メモがあればカードに表示し、なければ行を出さない', () => {
    const withMemo = FlexBuilder.buildItemCard(item({ memo: '詰め替え用を買う' }));
    const withoutMemo = FlexBuilder.buildItemCard(item({ memo: null }));
    if (withMemo.type !== 'flex' || withoutMemo.type !== 'flex') return;
    const texts = (m: typeof withMemo) =>
      flatten(m.contents).map((n) => n.text).filter((t): t is string => typeof t === 'string');
    expect(texts(withMemo)).toContain('詰め替え用を買う');
    expect(texts(withoutMemo)).not.toContain('メモ');
  });

  it('購入履歴を最大3件表示する', () => {
    const purchases: Purchase[] = Array.from({ length: 5 }, (_, i) => ({
      pageId: `h${i}`, itemPageId: 'page-1', purchasedAt: `2026-07-0${i + 1}`, store: null,
    }));
    const message = FlexBuilder.buildItemCard(item(), purchases);
    if (message.type !== 'flex') return;
    const texts = flatten(message.contents).map((n) => n.text).filter((t): t is string => typeof t === 'string');
    expect(texts.filter((t) => t.startsWith('・2026-07-')).length).toBe(3);
  });
});

describe('buildHelpMessage ほか', () => {
  it('ヘルプはテキストメッセージ', () => {
    const message = FlexBuilder.buildHelpMessage();
    expect(message.type).toBe('text');
    if (message.type !== 'text') return;
    expect(message.text).toContain('なくなった 品名');
  });

  it('全FlexメッセージにaltTextがある', () => {
    const messages = [
      FlexBuilder.buildItemListMessage('在庫一覧', [item()]),
      FlexBuilder.buildPickListMessage([item()], 'out'),
      FlexBuilder.buildItemCard(item()),
    ];
    for (const message of messages) {
      expect(message.type).toBe('flex');
      if (message.type === 'flex') expect(message.altText.length).toBeGreaterThan(0);
    }
  });
});
