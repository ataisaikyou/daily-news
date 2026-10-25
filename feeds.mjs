// ニュースのカテゴリと取得元（RSS）の設定
// フィードを追加・削除したいときはこのファイルを編集する

// 公開サイトのURL（前回のデータをここから読み戻して引き継ぐ）
export const SITE_URL = 'https://ataisaikyou.github.io/daily-news/';

// 速報以外のニュースを取り直す間隔（分）。速報と地震情報はワークフローが動くたび（5分ごと）に取得する
export const NEWS_INTERVAL_MIN = 30;

// Googleニュースのキーワード検索RSSのURLを作る
const googleNews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ja&gl=JP&ceid=JP:ja`;

// ジャンルを問わない速報（5分ごとに取得）
// onlyFlash: タイトルに「速報」を含む記事だけ使う
export const breaking = {
  hours: 3,      // 直近何時間の記事を出すか
  maxItems: 30,
  x: '速報 lang:ja',
  feeds: [
    { name: 'NHK', url: 'https://www.nhk.or.jp/rss/news/cat0.xml' },
    { name: '毎日新聞', url: 'https://mainichi.jp/rss/etc/mainichi-flash.rss' },
    { name: '朝日新聞', url: 'https://www.asahi.com/rss/asahi/newsheadlines.rdf' },
    { name: 'Googleニュース', url: googleNews('速報 when:1h'), onlyFlash: true },
  ],
};

// x: 「Xで検索」リンクの検索語
// major: true のフィードは「昨日／今日の主なニュース」として日付ごとに蓄積する
export const categories = [
  {
    id: 'domestic',
    name: '主要・国内',
    x: 'filter:news lang:ja',
    feeds: [
      { name: 'NHK', url: 'https://www.nhk.or.jp/rss/news/cat0.xml', major: true },
      { name: 'Yahoo!ニュース', url: 'https://news.yahoo.co.jp/rss/topics/top-picks.xml', major: true },
      { name: 'Yahoo!ニュース', url: 'https://news.yahoo.co.jp/rss/topics/domestic.xml' },
    ],
  },
  {
    id: 'world',
    name: '国際',
    x: '(国際 OR 海外) filter:news lang:ja',
    feeds: [
      { name: 'NHK', url: 'https://www.nhk.or.jp/rss/news/cat6.xml' },
      { name: 'Yahoo!ニュース', url: 'https://news.yahoo.co.jp/rss/topics/world.xml' },
      { name: 'BBC日本語', url: 'https://feeds.bbci.co.uk/japanese/rss.xml' },
      { name: 'CNN.co.jp', url: 'http://feeds.cnn.co.jp/rss/cnn/cnn.rdf' },
    ],
  },
  {
    id: 'tech',
    name: 'IT・テクノロジー',
    x: '(IT OR AI OR テクノロジー) filter:news lang:ja',
    feeds: [
      { name: 'ITmedia', url: 'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml' },
      { name: 'GIGAZINE', url: 'https://gigazine.net/news/rss_2.0/' },
      { name: 'Publickey', url: 'https://www.publickey1.jp/atom.xml' },
      { name: 'Yahoo!ニュース', url: 'https://news.yahoo.co.jp/rss/topics/it.xml' },
    ],
  },
  {
    id: 'game',
    name: 'ゲーム',
    x: 'ゲーム filter:news lang:ja',
    feeds: [
      { name: '4Gamer.net', url: 'https://www.4gamer.net/rss/index.xml' },
      { name: 'GAME Watch', url: 'https://game.watch.impress.co.jp/data/rss/1.0/gmw/feed.rdf' },
      { name: 'AUTOMATON', url: 'https://automaton-media.com/feed/' },
    ],
  },
  {
    id: 'disaster',
    name: '災害',
    x: '(地震 OR 大雨 OR 台風 OR 津波 OR 避難) lang:ja',
    feeds: [
      { name: 'Googleニュース', url: googleNews('地震 OR 大雨 OR 台風 OR 津波 OR 噴火 OR 避難指示 when:1d') },
    ],
  },
];

// 地震情報（P2P地震情報 API：気象庁の発表をJSONで配信、ブラウザからも直接取得できる）
export const quakeApi = 'https://api.p2pquake.net/v2/history?codes=551&limit=40';
