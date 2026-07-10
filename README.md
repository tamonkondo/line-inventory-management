# LINE Inventory Management

LINE Messaging API と Notion API を Google Apps Script(GAS)から連携し、家庭の在庫を「あるか / ないか」の boolean で管理するプロジェクトです。

- 「なくなった 品名」→ 在庫切れフラグON+家族全員へLINE通知
- 「買った 品名」→ 在庫ありに戻して購入履歴をNotionに記録
- 品目の追加・写真登録はLINEから、詳細な編集はNotion画面から

実装は TypeScript(`src/`)。esbuild で `dist/main.js` にバンドルして clasp で GAS へ push します。

## セットアップ

1. Node.js をインストールし、`npm install` を実行します。
2. `cp .env.example .env` で環境変数の控えを作り、実値を記入します(`.env` はコミットしないこと)。
3. Notion のDB(在庫・ユーザー・購入履歴)を作成します。手順は `docs/implementation/15-setup-e2e.md` を参照。
4. `npx clasp login` 後、`.clasp.json` を作成します:
   ```json
   { "scriptId": "<GASのスクリプトID>", "rootDir": "dist" }
   ```
5. GAS のスクリプトプロパティに `.env` と同じキー・値を登録します(キー一覧は `.env.example` 参照)。
6. `npm run push` でビルド+GASへ反映し、ウェブアプリとしてデプロイ。URLをLINE DevelopersのWebhookに設定します。
7. GASエディタから `setupRichMenu()` を実行してリッチメニューを登録します。

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run typecheck` | TypeScriptの型チェック(tsc --noEmit) |
| `npm test` | ユニットテスト(vitest) |
| `npm run build` | esbuildで `dist/main.js` を生成し `appsscript.json` をコピー |
| `npm run push` | ビルド+`.clasp.json` 検証+clasp push |

## ドキュメント

- 要件定義: `docs/requirements.md`
- Notion DB設計: `docs/notion-schema.md`
- 実装計画・実装書: `docs/implementation/00-plan.md` 〜 `15-setup-e2e.md`
