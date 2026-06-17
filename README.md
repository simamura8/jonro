# 🐺 人狼オンライン (Werewolf Online)

**人狼オンライン** は、ブラウザ上でリアルタイムに遊べるオンライン人狼ゲームです。
ダークファンタジーでリッチなUIと、リアルタイム通信によるスムーズなゲーム進行が特徴です。面倒なアカウント登録なしで、ルームURLを共有するだけですぐに友達と遊ぶことができます。

![UI Mockup](https://raw.githubusercontent.com/simamura8/jonro/main/wolf-girl.png) <!-- 必要に応じて画像を差し替えてください -->

## ✨ 主な機能

- 🔗 **簡単なルーム共有**: URLをコピーして共有するだけで参加可能。
- 🎭 **多彩な役職**: 村人、人狼、占い師、騎士、狂人、霊媒師、怪盗の7役職に対応。
- ⚙️ **柔軟な設定**: 参加人数に合わせた役職の自動割り当てや、初日の夜の犠牲者の「あり / なし」設定が可能。
- 💬 **リアルタイムチャット**: 昼の議論や夜の人狼チャット（赤い専用デザイン）など、Pusherによるリアルタイム同期。
- 👻 **充実した観戦機能（霊界）**: 死亡したプレイヤーは全員の役職が公開されるほか、「霊界チャット」で死亡者同士の会話を楽しんだり、夜の人狼の相談をのぞき見したりできます。
- ⏳ **議論タイマー**: 昼フェーズにはカウントダウンタイマー（3分）が表示され、議論の目安にできます。

## 🛠️ 技術スタック

- **Frontend**: React (18.x), Vite
- **Backend (API)**: Cloudflare Pages Functions
- **Database**: Cloudflare D1 (SQLite)
- **Realtime Sync**: Pusher Channels (WebSocket)
- **Styling**: Vanilla CSS (グラスモーフィズムデザイン)

## 🚀 開発環境のセットアップ

ローカルで開発・テストを行うための手順です。

### 1. 依存関係のインストール
プロジェクトの `frontend` ディレクトリに移動し、必要なパッケージをインストールします。

```bash
cd frontend
npm install
```

### 2. 環境変数の設定
`frontend/.dev.vars` ファイルを作成（または `.env` に設定）し、PusherのAPIキーなどを設定します。

```env
PUSHER_APP_ID=your_app_id
PUSHER_KEY=your_key
PUSHER_SECRET=your_secret
PUSHER_CLUSTER=your_cluster
```

### 3. 開発サーバーの起動
CloudflareのWranglerを利用して、Pages Functions（API）とVite（フロントエンド）を同時に起動します。

```bash
npm run dev:multi
```
起動後、ブラウザで `http://localhost:5173` にアクセスしてください。

## 🧪 テストの実行

ゲームロジックに関するユニットテストを実行するには、以下のコマンドを使用します。

```bash
npm run test
```
（Vitest を使用して60以上のテストケースを自動検証します）

## 📦 デプロイ

このプロジェクトは Cloudflare Pages に最適化されています。
GitHubリポジトリの `main` ブランチにプッシュすることで、CI/CDパイプラインを経由して自動的にビルドおよびデプロイが行われます。

1. 変更をステージング＆コミット
   ```bash
   git add .
   git commit -m "feat: your new feature"
   ```
2. プッシュして自動デプロイ
   ```bash
   git push origin main
   ```

## 📜 ライセンス

このプロジェクトは個人・友人間のプレイを想定した開発プロジェクトです。
