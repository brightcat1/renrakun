# れんらくん (renrakun)

**🌐 App URL:** `https://renrakun.pages.dev`

家庭の消耗品を「入力なしのタップ操作」で共有する PWA です。  
日常のチャットの会話ログに埋もれないよう、依頼を専用 UI と専用受信箱で管理します。

## できること（MVP）

- タッチパネル型 UI で消耗品をカートに追加して依頼送信
- グループ内メンバーへ Push 通知 + 受信箱イベント配信
- 依頼ステータス管理（`requested` / `acknowledged` / `completed`）
- 管理者のみ、グループ専用タブ・アイテムを追加可能
- 無料枠超過時は書き込み停止し、翌日 0:00 JST に自動復帰

## アーキテクチャと技術スタック

本アプリはフロントエンドとバックエンドを完全に分離し、エッジコンピューティングを活用した構成になっています。

- **Web (Frontend):** React + TypeScript + Vite + `vite-plugin-pwa` (Cloudflare Pages から配信)
- **API (Backend):** Cloudflare Workers (Hono) + D1 (SQLiteベースのEdge DB)
- **State Management:** Durable Objects を用いた日次の書き込み制限（Quota）管理
- **Shared:** `packages/shared` に Zod スキーマと共通型を配置
- **Monorepo:** pnpm workspace

## 開発環境のセットアップ

1. 依存関係のインストール:

```bash
pnpm install
```

2. 環境変数ファイルの準備:

```bash
cp apps/web/.env.example apps/web/.env
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

- `apps/web/.env` の `VITE_API_BASE_URL` を `http://127.0.0.1:8787` に設定
- `apps/api/.dev.vars` の `APP_ORIGIN` を `http://localhost:5173` に設定（ローカルCORS用）
- Push通知をテストする場合は `npx web-push generate-vapid-keys --json` で鍵を生成し、`apps/api/.dev.vars` と `apps/web/.env` に設定
- `wrangler.toml` の `APP_ORIGIN` は本番用URLのままでOKです。`pnpm dev:api`（`wrangler dev`）実行時は `.dev.vars` の値が優先されます

3. ローカル用 D1 マイグレーション:

```bash
cd apps/api
pnpm wrangler d1 migrations apply renrakun --local
```

4. 開発サーバーの起動:

```bash
# Terminal 1: API
pnpm dev:api

# Terminal 2: Web
pnpm dev:web
```

5. 本番DBの初期化（初回のみ）:

```bash
cd apps/api
pnpm wrangler d1 migrations apply renrakun --remote
```

## CI/CD とデプロイ

本リポジトリは GitHub Actions および Cloudflare Pages の連携機能を用いた自動デプロイ（CI/CD）パイプラインを構築しています。

- **API:** `main` ブランチへの Push 時、バックエンド関連ファイルの変更がある場合に GitHub Actions を経由して Cloudflare Workers へ自動デプロイされます。
- **Web:** リポジトリの更新を Cloudflare Pages が検知し、自動でビルド・デプロイが行われます。

## 使い方（開発版）

1. Web画面からグループを作成（表示名・合言葉）
2. 招待トークンを相手に共有し、相手が合言葉で参加
3. タブからアイテムをタップしてカートに追加し、送信
4. 受信側で `対応する` / `購入完了` にステータスを更新

## 一般的なチャットアプリとの違い

- 文字入力不要で依頼を送れる
- 日常の会話と話題が混ざらない専用受信箱
- 未対応の依頼が可視化される
- 家庭内運用に特化した固定のカタログとUI

## 免責と制約

- iOS PWA の Push は OS バージョンや通知許可設定の影響を受けます
- 無料枠設計のため、書き込み系 API は日次上限に達すると停止します
- 本 MVP には価格比較・在庫連携・EC 連携は含まれません
