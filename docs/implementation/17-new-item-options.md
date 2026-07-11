# 実装書(17): 新規登録フローのカテゴリ・購入先選択(R-13)

> **⚠️ 廃止(2026-07-11)**: 本書の選択フローは一度実装されたが、**R-14(詳細編集はNotionページへ直接誘導)により削除**された。
> 新規登録は「品名入力 → 登録 → NotionページURLを案内」、編集はカードの「編集(Notion)」ボタンからNotionを直接開く方式になった。
> 本書は経緯の記録として保持する。

- **依存**: 04, 07, 10, 11, 12(実装済みコードへの追加改修)
- **対象ファイル**: `src/clients/notionClient.ts`、`src/services/inventoryService.ts`、`src/types.ts`、`src/router/commandRouter.ts`、`src/handlers/postbackHandler.ts`、`src/handlers/messageHandler.ts`、`src/messages/flexBuilder.ts`、関連テスト

## 目的

新規登録時に、品名に加えて**カテゴリ(NotionのSelect)と購入先(NotionのMulti-select)を選択式で入力**できるようにする。
選択肢はNotion側のプロパティ定義から動的に取得し、LINE上にボタンとして表示する(タイプミス・表記ゆれの防止)。

## 1. 現状

- 「新規 品名」または「新規登録」ボタン→品名入力で、**品名のみ**の品目が即作成される(`InventoryService.create` は `category`/`stores` を受け取れるが、渡す導線がない)。
- カテゴリ・購入先は登録後にNotion画面か「編集」(購入先のみ・自由入力)で設定する必要がある。

## 2. 選択肢の取得(Notionスキーマから)

### 2.1 `NotionClient.retrieveDataSource(dataSourceId)` を追加

`GET /v1/data_sources/{id}` はデータソースのスキーマを返す。必要部分の型:

```ts
export interface NotionDataSourceMeta {
  id: string;
  properties: Record<string, {
    type?: string;
    select?: { options: Array<{ name: string }> };
    multi_select?: { options: Array<{ name: string }> };
  }>;
}
```

### 2.2 `InventoryService` に選択肢取得を追加

```ts
/** カテゴリ(Select)の選択肢名 */
getCategoryOptions(): string[]
/** 購入先(Multi-select)の選択肢名 */
getStoreOptions(): string[]
```

- `retrieveDataSource(CONFIG.NOTION_INVENTORY_DB_ID)` → `properties[P.CATEGORY].select.options` / `properties[P.STORES].multi_select.options` から `name` 配列を返す。
- プロパティ未定義・選択肢0件は空配列(例外にしない)。
- **CacheServiceに10分キャッシュ**(キー `notion:options:<propName>`)。選択タップのたびにNotionを叩かないため。Notion側で選択肢を増やした直後は最大10分反映が遅れるが許容。

## 3. セッション状態の拡張(`src/types.ts`)

```ts
export type SessionState =
  | { flow: 'new'; step: 'name' }
  | { flow: 'new'; step: 'category'; data: { name: string } }
  | { flow: 'new'; step: 'stores'; data: { name: string; category: string | null; stores: string[] } }
  | { flow: 'edit'; step: 'name' | 'stores'; data: { pageId: string } }
  | { flow: 'attach_photo'; step: 'wait'; data: { pageId: string } };
```

## 4. フロー仕様

```
「新規 品名」or「新規登録」ボタン→品名入力
  ↓ 品名の重複チェック(DUPLICATE_ITEMはこの時点で弾く。従来と同じ文言)
  ↓ session = {flow:'new', step:'category', data:{name}}
【カテゴリ選択】選択肢ボタン(最大12)+「スキップ」+「キャンセル」
  ↓ タップ: action=new&step=category&value=<name> / スキップ: action=new&step=category&value=
  ↓ session = {flow:'new', step:'stores', data:{name, category, stores: []}}
【購入先選択】選択肢ボタン+「決定」+「キャンセル」 ※複数選択
  ↓ タップ: action=new&step=store&value=<name> → data.storesにトグル(追加/削除)して
  │         「選択中: A / B」を含む同じ選択メッセージを再提示
  ↓ 決定: action=new&step=storesDone(未選択のまま決定=スキップ相当。ボタンラベルは「決定(設定しない)」)
  ↓ InventoryService.create({ name, category?, stores? })
登録完了: 品目カード+「写真を送ると登録できます」
  ↓ session = {flow:'attach_photo', step:'wait', data:{pageId}}(既存フロー)
```

設計上の決定:

- **品名の重複チェックは品名確定時に行う**(選択を進めた後に失敗させない)。`InventoryService.findByName` を使い、重複なら品名の再入力を促す(セッション維持)。※`create` 内の重複チェックは最終防衛として残す
- カテゴリ・購入先とも**スキップ可能**(従来どおり品名だけの登録もできる)
- 選択肢が**0件のステップは自動スキップ**(Notion側にまだ選択肢がない初期状態でも詰まらない)
- 購入先の**自由入力は受け付けない**(選択肢の追加はNotion画面で行う: R-05の役割分担を維持)。ただし選択メッセージに「選択肢の追加はNotionでできます」と1行添える
- テキスト入力がこのステップに来た場合は「ボタンから選んでください(またはキャンセル)」と再提示

## 5. postback data 追加分(実装書11の表に追記)

| data | 発生元 | 動作 |
| --- | --- | --- |
| `action=new&step=category&value=<encoded名>` | カテゴリ選択ボタン | data.categoryに設定(空文字=スキップ)→購入先選択へ |
| `action=new&step=store&value=<encoded名>` | 購入先選択ボタン | data.storesへトグル→選択メッセージ再提示 |
| `action=new&step=storesDone` | 「決定」ボタン | createを実行→完了カード+写真案内 |

- `value` は `encodeURIComponent` する(選択肢名に `&` `=` が含まれても壊れないように)。
- **セッション消失時**(TTL 300秒超過)にこれらのpostbackが来たら「最初からやり直してください」+新規登録の再開導線を返す(不整合な品目を作らない)。
- 注意: 実装書11で「postbackタップ時はセッションを必ず破棄」としたが、**`action=new&step=category/store/storesDone` はセッション継続が前提**のため、破棄の例外とする(handlePostback冒頭のclearを「newフロー系アクション以外」に限定する)。

## 6. 選択UI(`flexBuilder.ts`)

```ts
/** Select/Multi-select選択肢のボタン一覧(スキップ・決定・キャンセル付き) */
buildOptionPickMessage(params: {
  title: string;              // 「カテゴリを選んでください」等
  options: string[];          // 選択肢名(最大12。超過分は切ってフッタに案内)
  actionBase: string;         // 'action=new&step=category' 等(valueはビルダーが付与)
  selected?: string[];        // 購入先用: 選択中の表示(ボタンラベルに ✓ を付ける)
  allowSkip?: boolean;        // 「スキップ」ボタン
  allowDone?: boolean;        // 「決定」ボタン(複数選択用)
}): LineMessage
```

- 1バブル+ボタン縦積み。選択中の項目はラベル先頭に「✓ 」を付ける。
- 既存の `postbackButton` / `cancelButton` ヘルパーを再利用する。

## 7. ルーター/ハンドラの変更点

- `commandRouter.ts` の `handleNew` / `createNewItemMessages`:
  - 品名確定時は**createせず**、重複チェック→カテゴリ選択メッセージ+セッション設定に変更。
  - 実際のcreateは新設の `executeNewItemCreation(data, context)`(storesDone時に呼ぶ)へ移動。既存の「登録完了+カード+写真案内+attach_photoセッション」はそのまま再利用。
- `messageHandler.ts` の `handleSessionText`:
  - `new/name`: create せず重複チェック→カテゴリ選択へ(上と同じ関数を使う)。
  - `new/category`・`new/stores` 中のテキスト: 「ボタンから選んでください」(セッション維持)。
- `postbackHandler.ts`: §5の3アクションを追加。セッションから `data` を読み書きする。

## 8. 受け入れ基準

- [ ] 「新規登録」→品名→カテゴリ選択→購入先を2つ選択→決定 で、Notionにカテゴリ・購入先が設定された品目ができる。
- [ ] カテゴリ・購入先の選択肢がNotion側の定義と一致して表示される(手打ちの選択肢リストがコードにない)。
- [ ] 両ステップともスキップでき、品名だけの登録も従来どおり可能。
- [ ] 選択肢0件のステップは自動スキップされる。
- [ ] 重複品名は品名入力の時点で弾かれ、再入力できる。
- [ ] 選択途中の「キャンセル」で中断できる。セッション失効後のボタンタップで不整合な品目ができない。
- [ ] Notion側で選択肢を追加すると(最大10分後に)LINEの選択肢に反映される。
- [ ] 既存テストがパスし、選択フロー・選択肢取得のテストが追加されている。
- [ ] `npm run typecheck` / `npm test` / `npm run build` が通る。

## 9. E2Eチェックリスト追加分(実装書15 §5へ)

| # | 操作 | 期待結果 |
| --- | --- | --- |
| 23 | 「新規登録」→品名→カテゴリ「洗剤」→購入先「スーパー」「Amazon」→決定 | Notionの品目にカテゴリ・購入先が入っている |
| 24 | 「新規 米」→カテゴリをスキップ→購入先をスキップ | 品名だけの品目ができる(従来挙動) |
| 25 | Notionでカテゴリの選択肢を追加→10分後に新規登録 | 新しい選択肢がボタンに出る |
