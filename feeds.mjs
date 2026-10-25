// ニュースのカテゴリと取得元（RSS）の設定
// フィードを追加・削除したいときはこのファイルを編集する

// Googleニュースのキーワード検索RSSのURLを作る
const googleNews = (q) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ja&gl=JP&ceid=JP:ja`;

export const categories = [
  {
    id: 'domestic',
    name: '主要・国内',
    feeds: [
      { name: 'NHK', url: 'https://www.nhk.or.jp/rss/news/cat0.xml' },
      { name: 'Yahoo!ニュース', url: 'https://news.yahoo.co.jp/rss/topics/top-picks.xml' },
      { name: 'Yahoo!ニュース', url: 'https://news.yahoo.co.jp/rss/topics/domestic.xml' },
    ],
  },
  {
    id: 'world',
    name: '国際',
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
    feeds: [
      { name: '4Gamer.net', url: 'https://www.4gamer.net/rss/index.xml' },
      { name: 'GAME Watch', url: 'https://game.watch.impress.co.jp/data/rss/1.0/gmw/feed.rdf' },
      { name: 'AUTOMATON', url: 'https://automaton-media.com/feed/' },
    ],
  },
  {
    id: 'disaster',
    name: '災害',
    feeds: [
      { name: 'Googleニュース', url: googleNews('地震 OR 大雨 OR 台風 OR 津波 OR 噴火 OR 避難指示 when:1d') },
    ],
  },
];

// 地震情報（P2P地震情報 API：気象庁の発表をJSONで配信、ブラウザからも直接取得できる）
export const quakeApi = 'https://api.p2pquake.net/v2/history?codes=551&limit=40';
