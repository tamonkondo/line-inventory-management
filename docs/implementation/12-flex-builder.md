# 実装書(12): Flexメッセージ組み立て

- **依存**: 05(ドメイン型のみ。API呼び出しはしない)
- **対象ファイル**: `src/messages/flexBuilder.js`(実装)

## 目的

在庫情報をLINE上で見やすく表示するFlexメッセージを組み立てる。**このファイルは純粋な変換のみ**(サービス・クライアントを呼ばない)。

## 1. 公開メソッド

```js
var FlexBuilder = {
  /** 一覧(在庫一覧/不足一覧/検索結果) → Flexメッセージ1件 */
  buildItemListMessage: function (title, items) { ... },
  /** 品目選択リスト(なくなった/買った用) → Flexメッセージ1件 */
  buildPickListMessage: function (items, action) { ... }, // action: 'out'|'buy'
  /** 品目詳細カード */
  buildItemCard: function (item, purchases) { ... },      // purchases省略可
  /** 編集メニュー(名前/購入先/写真) */
  buildEditMenuMessage: function (item) { ... },
  /** ヘルプ */
  buildHelpMessage: function () { ... }
};
```

すべて **LINEメッセージオブジェクト1個**(`{type:'flex', altText, contents}` または `{type:'text', text}`)を返す。呼び出し側が配列に包む。

## 2. 共通ルール

- `altText` は必須: 「在庫一覧」「不足一覧」等、通知欄に出て意味が分かる文字列。
- **在庫状態の表現**: 在庫あり=「✅ あり」(色 `#06C755`)、在庫切れ=「❌ 切れ」(色 `#E63946`)。
- 写真: `item.photoUrl` があればサムネイル(bubbleの `hero` または行内 `image`)に使う。**httpsのURLのみ許可**(そうでなければ画像なしレイアウトへフォールバック)。
- Flexの制限: カルーセルは最大12バブル、バブル内ボタンは節度を持って(1バブル最大3ボタン程度)。
- 文言・レイアウトの微調整は実装者の裁量でよいが、含める情報(下記)は守る。

## 3. 各メッセージの内容仕様

### 3.1 `buildItemListMessage(title, items)`

- 形式: **1バブル+リスト行**(項目数が多くてもカルーセルにせず、縦に行を積む)。
- ヘッダ: title と件数(「在庫一覧(8件)」)。
- 各行(box, horizontal):
  - 品名(flex: 1, 折り返しなし・省略)
  - 状態(✅ あり / ❌ 切れ)
  - 行タップで `action=detail&id=<pageId>` のpostback(行全体に `action` を付ける)。
- **1メッセージに載せる行は最大20行**。超えたら20行で切り、フッタに「ほか N 件(検索や絞り込みを使ってください)」と表示。
- items が空のケースは呼び出し側(router)がテキストで返すため、ここでは考慮不要。

### 3.2 `buildPickListMessage(items, action)`

- 目的: 「どれが なくなった/買った ?」を1タップで選ばせる。
- 各行: 品名+右端に選択ボタン(またはリスト行タップ)→ `action=<action>&step=pick&id=<pageId>`。
- `displayText` を設定し、タップ時にトークへ「なくなった: 食器用洗剤」等が発言として残るようにする。
- 最大20行、超過分はフッタ案内(3.1と同じ)。
- 末尾に「キャンセル」ボタン(`action=cancel`)。

### 3.3 `buildItemCard(item, purchases)`

- 1バブル。
- `hero`: photoUrl があれば画像(aspectRatio '4:3', aspectMode 'cover')。
- body:
  - 品名(太字・大きめ)
  - 状態(✅/❌)
  - カテゴリ(あれば)
  - 購入先: `stores.join(' / ')`(あれば)
  - 最終購入日(あれば「最終購入: YYYY-MM-DD」)
  - purchases が渡されたら「最近の購入」として日付を最大3行
- footer ボタン:
  - 在庫ありのとき: 「なくなった」→ `action=out&step=pick&id=`
  - 在庫切れのとき: 「買った」→ `action=buy&step=pick&id=`
  - 「編集」→ `action=edit&step=menu&id=`
  - 「履歴」→ `action=history&id=`

### 3.4 `buildEditMenuMessage(item)`

- テキスト+ボタンで十分(Flexのシンプルなバブル)。
- 「(品名)の何を変えますか?」
- ボタン3つ: 名前を変える / 購入先を変える / 写真を変える → `action=edit&step=field&field=name|stores|photo&id=<pageId>`
- 「キャンセル」ボタン。
- ※ この3項目以外の編集はNotion側で行う旨を1行添える(R-05)。

### 3.5 `buildHelpMessage()`

テキストメッセージでよい:

```
📦 在庫管理Botの使い方

【メニュー or コマンド】
・在庫 … 在庫一覧
・不足 … 在庫切れの一覧
・なくなった 品名 … 在庫切れを報告(みんなに通知)
・買った 品名 … 在庫ありに戻して購入を記録
・新規 品名 … 品目を登録
・履歴 品名 … 購入履歴を見る
・検索 キーワード
・編集 品名 … 名前/購入先/写真を変更
・キャンセル … 途中の操作をやめる

品目の詳しい編集はNotionで行えます。
```

## 4. 実装上の注意

- Flex JSONの組み立ては、行生成(`itemRow_(item)`)・ボタン生成(`postbackButton_(label, data, displayText)`)などのプライベート関数に分解し、重複を避ける。
- postback data の文字列は実装書11の表と**完全一致**させる(スペルミスに注意)。
- pageId等を `encodeURIComponent` してdataに入れる。

## 5. 受け入れ基準

- [ ] 5メソッドすべてが有効なLINEメッセージオブジェクトを返す(実機で表示が崩れない)。
- [ ] altTextが全Flexに設定されている。
- [ ] photoUrlなし・カテゴリなし・購入先なしの品目でも表示できる(nullで例外にならない)。
- [ ] 21件以上で20件+「ほかN件」になる。
- [ ] このファイルから NotionClient / LineClient / 各Service を呼んでいない。

## 6. 動作確認方法

ダミーデータで組み立て、実機に送って表示確認:

```js
function test_flex() {
  var items = [
    { pageId: 'a', name: '食器用洗剤', inStock: true, category: '洗剤', photoUrl: null,
      stores: ['スーパー'], location: null, expiryDate: null, lastPurchasedAt: '2026-07-01' },
    { pageId: 'b', name: '米', inStock: false, category: '食品', photoUrl: null,
      stores: [], location: null, expiryDate: null, lastPurchasedAt: null }
  ];
  LineClient.push('U自分のuserId', [FlexBuilder.buildItemListMessage('在庫一覧', items)]);
  LineClient.push('U自分のuserId', [FlexBuilder.buildItemCard(items[0])]);
}
```
