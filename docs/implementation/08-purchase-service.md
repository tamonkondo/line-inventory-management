# 実装書(08): 購入履歴サービス

- **依存**: 04, 05, 07
- **対象ファイル**: `src/services/purchaseService.ts`(**新規作成**)

## 目的

「買った」操作を購入履歴DBへ記録し(F-17)、品目ごとの履歴参照(F-18)を提供する。

## 1. 実装内容

```ts
import { CONFIG, NOTION_PROPS } from '../config';
import { NotionClient } from '../clients/notionClient';
import { NotionMapper } from '../utils/notionMapper';
import type { InventoryItem, Purchase } from '../types';

const P = NOTION_PROPS.PURCHASES;

/** 購入履歴の記録・参照(F-17/F-18) */
export const PurchaseService = {
  /**
   * 購入を1件記録する。
   * @param item 対象品目
   * @param userPageId 記録者(UserのpageId)。不明ならnull
   */
  record(item: InventoryItem, userPageId: string | null): void {
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    NotionClient.createPage({
      parent: { database_id: CONFIG.NOTION_PURCHASES_DB_ID },
      properties: {
        [P.NAME]: { title: [{ text: { content: `${item.name} ${today}` } }] },
        [P.ITEM]: { relation: [{ id: item.pageId }] },
        [P.PURCHASED_AT]: { date: { start: today } },
        ...(userPageId ? { [P.RECORDED_BY]: { relation: [{ id: userPageId }] } } : {}),
      },
    });
  },

  /** 品目の直近購入履歴(購入日降順・最大limit件、既定5件) */
  listRecent(itemPageId: string, limit = 5): Purchase[] {
    const res = NotionClient.queryDatabase(CONFIG.NOTION_PURCHASES_DB_ID, {
      filter: { property: P.ITEM, relation: { contains: itemPageId } },
      sorts: [{ property: P.PURCHASED_AT, direction: 'descending' }],
      page_size: limit,
    });
    return res.results.map((page) => NotionMapper.toPurchase(page));
  },
};
```

## 2. 仕様メモ

- 購入日は当面「記録した日」固定。過去日の指定UIは作らない(必要ならNotion画面で直す)。
- 購入先(Store)は record では設定しない(どこで買ったかの入力ステップは初期リリースでは省略。Notion画面で後付け可能)。
- 数量カラムは存在しない(R-08)。
- 在庫DBの「最終購入日」はRollupなので、履歴を作れば自動で更新される(GASからの更新不要)。Rollupが期待通り動かない場合の代替(在庫DBにDateを持ちGASで更新)は実装書15の検証で判断する。

## 3. 受け入れ基準

- [ ] `record` で購入履歴DBに「品名 YYYY-MM-DD」のタイトルの行が増え、対象品目Relation・購入日・記録者(渡した場合)が入る。
- [ ] `listRecent` が購入日降順で返り、他品目の履歴が混ざらない。
- [ ] `userPageId=null` でもエラーにならない(記録者が空になるだけ)。
- [ ] 在庫DB側の「最終購入日」(Rollup)が record 後に更新されることを目視確認。
- [ ] `npm run typecheck` が通る。

## 4. 動作確認方法

```ts
export const test_purchase = (): void => {
  const item = InventoryService.findByName('食器用洗剤');
  if (!item) throw new Error('テストデータがありません');
  PurchaseService.record(item, null);
  logInfo('test', PurchaseService.listRecent(item.pageId, 3)); // 先頭が今日の日付
};
```
