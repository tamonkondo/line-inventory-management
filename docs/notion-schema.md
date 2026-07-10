# Notion DB 設計書

要件定義書 v1.0 ＋ v1.1 追加要望（`requirements.md` 11章）を反映した設計案。
**在庫は数量ではなく boolean（あり / なし）で管理する（R-08）。**
DB 作成後に、実際のデータベースID・プロパティ名をここに確定記載する。

## DB 一覧

| DB | 用途 | 状態 |
| --- | --- | --- |
| 在庫DB（Inventory） | 品目マスタ兼在庫状態管理 | 設計案 |
| ユーザーDB（Users） | Bot利用ユーザー管理 | 設計案 |
| 購入履歴DB（PurchaseHistory） | 商品ごとの購入記録（v1.1で新設） | 設計案 |

## 在庫DB（Inventory）

| プロパティ | 型 | 説明 |
| --- | --- | --- |
| 品名（Name） | Title | 例: 食器用洗剤 |
| **在庫あり（InStock）** | **Checkbox** | ON=在庫あり / OFF=在庫切れ。唯一の在庫状態。数量・しきい値は持たない |
| カテゴリ（Category） | Select | 品目分類。洗剤 / 食品 / 日用品 など |
| 写真（Photo） | Files & media | 商品写真。LINEから登録（v1.1） |
| 購入先（Stores） | Multi-select | 購入先カテゴリー。複数可（v1.1） |
| 最終購入日（LastPurchasedAt） | Rollup → 購入履歴.購入日 の最大値 | Rollup制約が問題になれば Date ＋ GAS更新に変更（v1.1） |
| 購入履歴（Purchases） | Relation → PurchaseHistory | 双方向Relation（v1.1） |
| 保管場所（Location） | Select | 任意 |
| 賞味期限（ExpiryDate） | Date | 任意。通知は将来拡張 |
| 最終更新日（UpdatedAt） | Last edited time | 自動 |
| 更新者（UpdatedBy） | Relation → Users | 任意 |

- 不足一覧＝ `InStock = false` でフィルタするだけ。
- 「残りわずか」等の中間状態は持たない。必要になったら Checkbox → Select（あり / 残りわずか / 切れ）への拡張余地あり。

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
| 購入先（Store） | Select | 任意 |
| 記録者（RecordedBy） | Relation → Users | 任意 |

## 状態遷移と運用ルール

```
「なくなった」（LINE） → InStock = OFF ＋ 全員へ即時通知
「買った」　（LINE） → InStock = ON  ＋ 購入履歴に1レコード追加
```

- 品目マスタの編集（カテゴリ・保管場所・選択肢の管理）は **Notion 画面を正** とする（R-05）。
- LINE からは「新規品目登録」「なくなった／買った」「画像・名前・購入先の変更」のみ行う（R-05/R-06）。
- Notion 画面から InStock を直接切り替えることも可能だが、その場合は通知・購入履歴は発生しない（Webhookを持たないGAS構成のため）。

## 確定後に記載する項目（TODO）

- 各DBの database_id
- Multi-select / Select の初期選択肢
