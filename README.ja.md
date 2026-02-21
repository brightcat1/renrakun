# れんらくん (renrakun)

`renrakun` は、家庭内の買い物依頼をタップ操作だけで共有する PWA です。  
日常チャットに埋もれやすい依頼を、専用UIと受信箱で管理します。

## できること (MVP)

- タッチパネルUIで消耗品を選び、素早く依頼送信
- 招待リンク + 合言葉でグループ参加（アカウント登録なし）
- 依頼ステータス管理（`依頼中` / `対応中` / `購入完了`）
- Push通知でロック画面に依頼要約（誰が・何を）を表示
- グループ作成者によるカスタムタブ・カスタムアイテム管理
- 無料枠保護（日次制限・自動復帰・段階的クリーンアップ）

## アーキテクチャと技術スタック

- **Web**: React + TypeScript + Vite + `vite-plugin-pwa`（Cloudflare Pages）
- **API**: Cloudflare Workers (Hono) + D1
- **State**: Durable Objects（QuotaGate）
- **Shared**: `packages/shared`（Zodスキーマと共通型）
- **Monorepo**: pnpm workspace

```mermaid
graph TD
  subgraph Client["Client (Browser / PWA)"]
    UI["Web App\n(React + Vite PWA)"]
    SW["Service Worker"]
    LS[("LocalStorage\n(Session/Device)")]
  end

  subgraph Edge["Cloudflare Edge"]
    API["Workers API\n(Hono)"]
    DO[("Durable Object\nQuotaGate")]
    DB[("D1 Database")]
    CRON["Cron Trigger\n(Daily Maintenance)"]
  end

  subgraph Push["Web Push Service"]
    PS["Apple / Google / Mozilla"]
  end

  UI -->|REST| API
  UI -->|Store/Read| LS
  UI -->|Sync Context| SW

  API -->|Read/Write + Activity Tracking| DB
  API -->|Quota Check| DO
  API -->|Trigger Push| PS

  PS -.->|Push Event| SW
  SW -->|GET /api/push/pending| API
  API -->|Fetch & Mark Delivered| DB
  SW -->|Show Notification| UI

  CRON -->|Quota Reset & Auto Cleanup| API
  API --> DB
```

## ローカル開発セットアップ

1. 依存関係インストール

```bash
pnpm install
```

2. 環境変数ファイル作成

```bash
cp apps/web/.env.example apps/web/.env
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

- `apps/web/.env` の `VITE_API_BASE_URL` を `http://127.0.0.1:8787` に設定
- `apps/api/.dev.vars` の `APP_ORIGIN` を `http://localhost:5173` に設定
- Pushテスト時は `npx web-push generate-vapid-keys --json` で鍵を生成し、`.dev.vars` と `.env` に設定

3. ローカルDBへマイグレーション適用

```bash
cd apps/api
pnpm wrangler d1 migrations apply renrakun --local
```

4. 開発サーバー起動

```bash
# Terminal 1: API
pnpm dev:api

# Terminal 2: Web
pnpm dev:web
```

## 本番セットアップ

1. 本番D1へマイグレーション適用（初回 + スキーマ変更時）

```bash
cd apps/api
pnpm wrangler d1 migrations apply renrakun --remote
```

2. Push用Secrets登録

```bash
cd apps/api
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_SUBJECT
```

## CI/CD

- API: GitHub Actions から Workers へ自動デプロイ
- Web: Cloudflare Pages で自動ビルド/デプロイ
- APIマイグレーションは CI で次を実行（対話プロンプト回避）:

```bash
d1 migrations apply renrakun --remote --auto-confirm
```

## Pushトラブルシュート

通知が届かない場合は次の順で確認してください。

1. アプリ内 `通知を再同期` を実行
2. `参加中メンバー` カードで通知状態（通知OK / 通知未設定）を確認
3. マイグレーション適用状況（`--local` / `--remote`）を確認
4. `wrangler tail` で APIログを確認

## PWAライフサイクルとデータ同期（仕様）

- クライアント更新は Service Worker の更新フローで提供され、再インストールは更新モデルに含みません。
- 新しい Service Worker は `skipWaiting` + `clientsClaim` で有効化されます。UIバンドルの反映は、作業中の強制リロードを避けるため、ドキュメントがバックグラウンドへ遷移したタイミング（`visibilityState: hidden`）で意図的にリロードして取り込みます。
- プライベートデータ同期（ログイン中のみ）は無料枠を考慮したハイブリッド方式です。
  - Push受信時に Service Worker から `postMessage`（`REFRESH_DATA`）で更新要求
  - 画面復帰（`focus` / `online` / 可視化復帰）で更新
  - 画面表示中のみ45秒間隔でポーリング更新
- 自動同期は多重実行を抑止し、最短5秒の間引きを行い、明示的なロード中は実行しません。
- 手動の `更新` 操作はフォールバック手段として提供します。

## 手動整理向けの活動追跡（last_activity_at）

D1ストレージの無料枠容量制限（500MB）を効率的に運用するため、活動状況のトラッキングを導入しています。

### 1. 設計判断とトレードオフ

本システムでは、あえて「全自動削除」ではなく「手動整理のための指標提供」を優先しています。

* **無料枠の書き込み保護（Rows Written）**: 読み取り専用API（インボックスの取得、カタログ参照等）では、last_activity_at の更新を行いません。これは、日常的なアプリ利用による不要なD1書き込みを抑止し、無料枠のクォータを節約するためです。
* **安全性の確保**: 家庭内の重要なデータを扱う性質上、自動ロジックによる誤削除のリスクを完全に排除し、最終的な削除判断を人間（管理者）が行えるようにしています。
* **実利的なアプローチ**: テキスト主体のデータ構造では500MBを使い切るまでに十分な猶予があるため、現時点での自動化は「過剰実装（Over-engineering）」と判断し、シンプルな活動追跡に留めています。

### 2. 更新ルール

* **更新される（Write）**: グループ作成・参加、依頼作成・更新、カタログ編集、Push購読更新。
* **更新されない（Read）**: カタログ・レイアウト取得、インボックス取得、Push未読取得。

### 3. 手動抽出SQL例（180日以上未活動）

SELECT 
  g.id, 
  COALESCE(g.last_activity_at, g.created_at) as effective_last_activity, 
  COUNT(m.id) as members
FROM groups g
LEFT JOIN members m ON g.id = m.group_id
WHERE COALESCE(g.last_activity_at, g.created_at) < date('now', '-180 days') -- 別名ではなく元の式を書く
  AND NOT EXISTS (
    SELECT 1 FROM requests r 
    WHERE r.group_id = g.id AND r.status IN ('requested', 'acknowledged')
  )
GROUP BY g.id;

## 仕様・制限事項

- **iOS対応**: iOSのWeb PushはOSバージョン・ホーム画面追加・通知許可設定に依存します。
- **プライバシー**: 通知要約はロック画面に表示されるため、機微情報の送信は避けてください。
- **書き込み制限**: 無料枠保護のため、API書き込みは日次上限に達すると一時停止し、翌 0:00 JST に自動復帰します。
- **依頼の保持**: 「購入完了」済みの依頼は既定14日後に自動削除されます。「依頼中」「対応中」は自動削除しません。
- **未使用グループ**: メンバー1名のみ・通知設定なし等の条件を満たす場合、Cron Triggerにより段階的に整理（候補化60日 + 猶予30日）されます。
- **スコープ**: 本MVPに価格比較・在庫管理・EC連携は含みません。
