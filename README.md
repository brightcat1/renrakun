# renrakun (れんらくん)

Tap-first household request app.

家庭内の「買ってほしい / 行きたい」依頼を、専用タッチパネルでサッと共有できます。
会員登録なしで、すばやく共有できるPWAです。

- **App URL:** [renrakun.pages.dev](https://renrakun.pages.dev)
- **日本語ドキュメント:** [README.ja.md](README.ja.md)
- **English documentation:** [README.en.md](README.en.md)

## Feature Gallery / 特徴ギャラリー

### 1) No account start / 会員登録なしですぐ開始
Display name + passphrase only. Invite link sharing is built-in.

表示名 + 合言葉だけで開始できます。招待リンク共有も標準対応です。

<p>
  <img src="docs/screenshots/01-onboarding-no-account-ja.png" width="48%">
  <img src="docs/screenshots/02-onboarding-language-switch-en.png" width="48%">
</p>

### 2) Member visibility / 参加メンバーの可視化
See who is in the group and who has notifications enabled.

グループ参加者と通知状態（通知OK / 未設定）を一目で確認できます。

<img src="docs/screenshots/03-dashboard-members-push-status.png" width="48%">

### 3) Tap-only cart controls / タップ中心の操作
`+` adds, `-` reduces. Place selection is single-select and easy to clear.

`+` で追加、`-` で減算。場所選択は単一選択で、解除も簡単です。

<p>
  <img src="docs/screenshots/04-touch-panel-plus-cart.png" width="48%">
  <img src="docs/screenshots/05-touch-panel-minus-cart.png" width="48%">
</p>

### 4) Intent switch: Need to buy / Want to visit / 依頼テンプレ切替
Switch between `Need to buy` and `Want to visit`.

「買ってほしい」と「行きたい」を切り替え。`行きたい` は場所のみ送信です。

<img src="docs/screenshots/06-intent-visit.png" width="48%">

### 5) Admin customization / 作成者によるカスタム管理
Group creator can add/archive-delete custom tabs, items, and places.

グループ作成者は、カスタムタブ・アイテム・場所を追加/削除できます。

<p>
  <img src="docs/screenshots/07-admin-custom-tab-item-store.png" width="48%">
  <img src="docs/screenshots/08-store-custom-delete-flow.png" width="48%">
</p>

### 6) Inbox status workflow / 受信箱ステータス管理
Track requests through `Requested` -> `In progress` -> `Completed`.

受信箱で `依頼中` -> `対応中` -> `完了` を管理できます。

<p>
  <img src="docs/screenshots/09-inbox-status-flow.png" width="32%">
  <img src="docs/screenshots/09-inbox-status-flow2.png" width="32%">
  <img src="docs/screenshots/09-inbox-status-flow3.png" width="32%">
</p>

### 7) Lock-screen push summary / ロック画面通知（要約）
Push shows a concise summary (who + what) to reduce app-open friction.

ロック画面で「誰が・何を」を要約表示し、確認の手間を減らします。

<p>
  <img src="docs/screenshots/10-lock-screen-push-summary.png" width="32%">
  <img src="docs/screenshots/10-lock-screen-push-summary2.png" width="32%">
  <img src="docs/screenshots/10-lock-screen-push-summary3.png" width="32%">
</p>

## Notes / 補足

- This README is a visual overview (screenshot-first). See [README.en.md](README.en.md) for technical details and usage.
- このREADMEは、機能を直感的に伝えるため画像中心に構成されています。技術的な詳細は [README.ja.md](README.ja.md) を参照してください。