# MusicDB Bot (Render 版 最小スターター)

このリポジトリは Render 無料枠で常時稼働させるための最小構成です。

## 1. 必要ファイル
- `server.js` : Express アプリ本体（Discord 署名検証あり / Slash Command 最小実装）
- `package.json` : 依存関係と起動スクリプト
- `render.yaml` : Render での自動設定用（任意）

## 2. デプロイ手順（概要）
1. GitHub にこの3ファイルをコミット（公開リポジトリ）
2. Render → New → Web Service → 公開リポジトリの URL を指定
3. Build: `npm install` / Start: `node server.js`
4. 環境変数に **DISCORD_PUBLIC_KEY** を設定（他は後からでOK）
5. Discord Developer Portal の "Interactions Endpoint URL" に
   `https://<your-render-url>/discord/commands` を設定

## 3. Slash コマンド例（手動登録）
- `track_search` (options: title [string], artist [string, optional])
- `artist_list` (options: name [string])

## 4. テスト
- `/` にアクセス → `MusicDB Bot Server is running`
- Discord で `track_search` を実行 → 「検索受付」メッセージが返る

## 5. 注意
- 本スターターは最小実装です。DB・Drive・Dropbox 連携は後から追加してください。
- Discord の署名検証は `tweetnacl` を使用し、Ed25519 で照合しています。

（生成: 2025-10-15T08:47:12.318379）
