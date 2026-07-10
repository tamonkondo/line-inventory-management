# Notion DB 設計書

要件定義書 v1.0 ＋ v1.1 追加要望（`requirements.md` 11章）を反映した設計案。
DB 作成後に、実際のデータベースID・プロパティ名をここに確定記載する。

## DB 一覧

| DB | 用途 | 状態 |
| --- | --- | --- |
| 在庫DB（Inventory） | 品目マスタ兼在庫数管理 | 設計案 |
| ユーザーDB（Users） | Bot利用ユーザー管理 | 設計案 |
| 購入履歴DB（PurchaseHistory） | 商品ごとの購入記録（v1.1で新設） | 設計案 |

## 在庫DB（Inventory）

| プロパティ | 型 | 説明 |
| --- | --- | --- |
| 品名（Name） | Title | 例: 食器用洗剤 |
| カテゴリ（Category） | Select | 品目分類。洗剤 / 食品 / 日用品 など |
| 数量（Quantity） | Number | 現在の在庫数 |
| 単位（Unit） | Select | 個 / 本 / 袋 / g など |
| 下限しきい値（Threshold） | Number | この値以下で「不足」判定 |
| 状態（Status） | Formula | 数量としきい値から自動判定（十分 / 残りわずか / 不足 / **在庫切れ**） |
| 写真（Photo） | Files & media | 商品写真。LINEから登録（v1.1） |
| 購入先（Stores） | Multi-select | 購入先カテゴリー。複数可（v1.1） |
| 最終購入日（LastPurchasedAt） | Rollup → 購入履歴.購入日 の最大値 | Rollup制約が問題になれば Date ＋ GAS更新に変更（v1.1） |
| 購入履歴（Purchases） | Relation → PurchaseHistory | 双方向Relation（v1.1） |
| 保管場所（Location） | Select | 任意 |
| 賞味期限（ExpiryDate） | Date | 任意。通知は将来拡張 |
| 最終更新日（UpdatedAt） | Last edited time | 自動 |
| 更新者（UpdatedBy） | Relation → Users | 任意 |

状態（Status）の Formula 案:

```
数量 = 0 → "在庫切れ"
数量 <= しきい値 → "不足"
数量 <= しきい値 * 1.5 → "残りわずか"
それ以外 → "十分"
```

## ユーザーDB（Users）

| プロパティ | 型 | 説明 |
| --- | --- | --- |
| 表示名（Name） | Title | LINE表示名（follow時に取得） |
| LINE User ID | Text | Messaging API の userId（一意キー） |
| ステータス（Status） | Select | 有効 / 無効 |
| 登録日（RegisteredAt） | Date | followイベント発生日 |

## 購入履歴DB（PurchaseHistory）※v1.1 新設

| プロパティ | 型 | 説明 |
| --- | --- | --- |
| 名前（Name） | Title | 「品名 2026-07-10」等をGASで自動生成 |
| 対象品目（Item） | Relation → Inventory | |
| 購入日（PurchasedAt） | Date | 既定は記録日。過去日も指定可 |
| 数量（Quantity） | Number | 購入した数量 |
| 購入先（Store） | Select | 任意 |
| 記録者（RecordedBy） | Relation → Users | 任意 |

## 運用ルール

- 品目マスタの編集（しきい値・単位・保管場所・選択肢の管理）は **Notion 画面を正** とする（R-05）。
- LINE からは「新規品目登録」「在庫の増減」「画像・名前・購入先の変更」のみ行う（R-05/R-06）。
- LINE での在庫追加は「購入」として購入履歴DBへ1レコード追加する（F-17）。数量の上書き修正は履歴に残さない。

## 確定後に記載する項目（TODO）

- 各DBの database_id
- Multi-select / Select の初期選択肢
- Status Formula の確定式
