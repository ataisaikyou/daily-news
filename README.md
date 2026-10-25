# 今日のニュース

主要・国内／国際／IT・テクノロジー／ゲーム／災害のニュース見出しを自動で集めて表示するサイトです。

- 公開URL: https://ataisaikyou.github.io/daily-news/
- GitHub Actions が **1時間ごと** にRSSを取得してページを作り直し、GitHub Pages に公開します
- 地震情報はページを開いている間、ブラウザが **2分ごと** に最新を取得します（P2P地震情報 API）

## ニュースの取得元を変える

[feeds.mjs](feeds.mjs) を編集して push するだけです（push すると自動で再公開されます）。

## 今すぐ更新したいとき

GitHub のリポジトリ → **Actions** → **ニュース更新** → **Run workflow**

## 手元で確認する

```
npm install
npm run build     # dist/ にサイトを生成
npm run preview   # http://localhost:8080 で表示
```
