// RSSと地震情報を取得して dist/ に静的サイトを生成する
// 5分ごとに実行される想定：速報・地震は毎回、その他のニュースは NEWS_INTERVAL_MIN ごとに取り直す
// 前回の取得結果は公開サイトの state.json から読み戻して引き継ぐ
import { XMLParser } from 'fast-xml-parser';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { breaking, categories, NEWS_INTERVAL_MIN, quakeApi, SITE_URL, TRIGGER_URL } from '../feeds.mjs';
import { escapeHtml, formatJst, newsList, renderQuakes } from '../src/render.js';

const ROOT = new URL('../', import.meta.url);
const DIST = new URL('dist/', ROOT);
const UA = 'Mozilla/5.0 (compatible; daily-news/1.0; +https://github.com/ataisaikyou/daily-news)';
const MAX_AGE_HOURS = 48; // これより古い記事は出さない
const MAX_ITEMS = 40;     // カテゴリごとの最大件数
const DAY = 86400e3;
const JST_OFFSET = 9 * 3600e3;
const FORCE_FULL = process.env.FORCE_FULL === '1';
// 手元での動作確認用に環境変数で差し替えられるようにしておく
const TRIGGER = process.env.TRIGGER_URL ?? TRIGGER_URL;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  htmlEntities: true,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'link',
});

// 日本時間でその日の0時（UTCミリ秒）
const jstDayStart = (ms) => Math.floor((ms + JST_OFFSET) / DAY) * DAY - JST_OFFSET;

// 文字コードを判定してテキストとして取得する（Shift_JIS などのフィードにも対応）
async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const head = new TextDecoder('latin1').decode(buf.slice(0, 200));
  const charset = res.headers.get('content-type')?.match(/charset=([\w-]+)/i)?.[1]
    ?? head.match(/encoding=["']([\w-]+)/i)?.[1]
    ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

// パース結果の値から文字列を取り出す
function text(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text(v['#text']);
  return String(v)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();
}

// RSS2.0 の <link>URL</link> と Atom の <link href rel> の両方に対応
function pickLink(v) {
  for (const l of Array.isArray(v) ? v : [v]) {
    if (typeof l === 'string' && l.trim()) return l.trim();
    if (l?.['@_href'] && (!l['@_rel'] || l['@_rel'] === 'alternate')) return l['@_href'];
  }
  return '';
}

function toTime(s) {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

// RSS 2.0 / RSS 1.0(RDF) / Atom を共通の形にそろえる
function parseFeed(xml, feedName) {
  const doc = parser.parse(xml);
  const items = doc.rss?.channel?.item ?? doc['rdf:RDF']?.item ?? doc.feed?.entry ?? [];
  return items.map((it) => {
    const source = text(it.source) || feedName;
    let title = text(it.title);
    // Googleニュースはタイトル末尾に「 - 媒体名」が付くので外す
    if (title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    return {
      title,
      link: pickLink(it.link) || text(it.guid),
      time: toTime(text(it.pubDate) || text(it['dc:date']) || text(it.published) || text(it.updated)),
      source,
    };
  });
}

async function loadFeed(label, feed) {
  try {
    const items = parseFeed(await fetchText(feed.url), feed.name);
    console.log(`  ✓ [${label}] ${feed.name}: ${items.length}件`);
    return items;
  } catch (e) {
    console.warn(`  ✗ [${label}] ${feed.name}: ${e.message} (${feed.url})`);
    return [];
  }
}

// 重複を除いて新しい順に並べる（タイトルかリンクが同じものは重複とみなす）
function uniqueSorted(items) {
  const seen = new Set();
  const unique = items.filter((it) => {
    if (!it.title || !/^https?:\/\//.test(it.link)) return false;
    const key = it.title.replace(/\s/g, '');
    if (seen.has(it.link) || seen.has(key)) return false;
    seen.add(it.link);
    seen.add(key);
    return true;
  });
  return unique.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
}

// 古すぎる記事を落とす。新しい記事が少ないカテゴリでも空にならないよう最低10件は出す
function pickItems(items, now) {
  const unique = uniqueSorted(items);
  const fresh = unique.filter((it) => it.time && now - it.time <= MAX_AGE_HOURS * 3600e3);
  return (fresh.length >= 10 ? fresh : unique.slice(0, 10)).slice(0, MAX_ITEMS);
}

// 公開中のサイトから前回の state.json を読む（初回は404で null）
async function loadPrevState(now) {
  // 手元での動作確認用：PREV_STATE_FILE にファイルを指定するとそれを前回分として使う
  if (process.env.PREV_STATE_FILE) return JSON.parse(await readFile(process.env.PREV_STATE_FILE, 'utf8'));
  const res = await fetch(`${SITE_URL}state.json?t=${now}`, { signal: AbortSignal.timeout(20000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`前回データの取得に失敗: HTTP ${res.status}`);
  return res.json();
}

// 速報以外のニュース（30分ごと）
async function loadCategories(now) {
  const results = await Promise.all(categories.flatMap((cat) =>
    cat.feeds.map(async (feed) => ({ cat: cat.id, major: !!feed.major, items: await loadFeed(cat.name, feed) }))));
  return {
    categories: categories.map((cat) => ({
      id: cat.id,
      items: pickItems(results.filter((r) => r.cat === cat.id).flatMap((r) => r.items), now),
    })),
    major: results.filter((r) => r.major).flatMap((r) => r.items),
  };
}

// 速報（毎回）。取得に失敗したフィードがあっても前回分と合わせて表示を保つ
async function loadBreaking(now, prevItems) {
  const lists = await Promise.all(breaking.feeds.map(async (feed) => {
    const items = await loadFeed('速報', feed);
    return feed.onlyFlash ? items.filter((it) => it.title.includes('速報')) : items;
  }));
  return uniqueSorted([...lists.flat(), ...prevItems])
    .filter((it) => it.time && it.time <= now + 600e3 && now - it.time <= breaking.hours * 3600e3)
    .slice(0, breaking.maxItems);
}

async function loadQuakes(prev) {
  try {
    const res = await fetch(quakeApi, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    console.log(`  ✓ 地震情報: ${list.length}件`);
    // 観測点の一覧などは使わないので、表示に必要な項目だけ残す
    return list.map(({ earthquake: e }) => ({
      earthquake: e && { time: e.time, hypocenter: e.hypocenter, maxScale: e.maxScale, domesticTsunami: e.domesticTsunami },
    }));
  } catch (e) {
    console.warn(`  ✗ 地震情報: ${e.message}`);
    return prev ?? [];
  }
}

// ---- HTML 生成 ----

const xUrl = (q) => `https://x.com/search?q=${encodeURIComponent(q)}&f=live`;
const xLink = (q, label = 'Xで検索') =>
  `<a class="x-link" href="${escapeHtml(xUrl(q))}" target="_blank" rel="noopener">${escapeHtml(label)} ↗</a>`;

// 先頭 n 件だけ見せて、残りは「もっと見る」で開く一覧
function clipList(html, n, attrs = '') {
  return `<div class="clip clip-${n}"${attrs}>${html}</div>
<button type="button" class="more-btn" data-more>もっと見る</button>`;
}

const JMA_LINKS = `<p class="links">
  <a href="https://www.jma.go.jp/bosai/warning/" target="_blank" rel="noopener">警報・注意報</a>
  <a href="https://www.jma.go.jp/bosai/map.html#contents=earthquake_map" target="_blank" rel="noopener">地震情報</a>
  <a href="https://www.jma.go.jp/bosai/map.html#contents=tsunami" target="_blank" rel="noopener">津波情報</a>
  <a href="https://www.jma.go.jp/bosai/nowc/" target="_blank" rel="noopener">雨雲レーダー</a>
</p>`;

// ---- 左：速報 ----
function breakingBox(state) {
  return `<section class="box box-breaking">
  <h2 class="box-title">速報<span class="live" data-breaking-status>5分ごと更新</span></h2>
  ${clipList(newsList(state.breaking.items), 10, ` data-breaking="${breaking.maxItems}"`)}
  <p class="box-foot">${xLink(breaking.x, 'Xで「速報」を検索')}</p>
</section>`;
}

// ---- 中央：ジャンル別のタブ ----
function topicPanel(cat) {
  return `<div class="panel" data-panel="${cat.id}">
  ${clipList(newsList(cat.items), 10)}
  <p class="box-foot"><span class="count">${cat.items.length}件</span>${xLink(cat.x, `Xで「${cat.name}」を検索`)}</p>
</div>`;
}

function dailyPanel(days, now) {
  const yLabel = formatJst(jstDayStart(now) - DAY).split(' ')[0];
  return `<div class="panel" data-panel="daily">
  <p class="note">NHK・Yahoo!ニュースの「主要」に載ったニュースを日付ごとに集めています</p>
  <h3 class="sub">今日（0時〜現在）<span class="count">${days.today.length}件</span></h3>
  ${clipList(newsList(days.today, { abs: true }), 10)}
  <h3 class="sub">昨日（${yLabel}）<span class="count">${days.yesterday.length}件</span></h3>
  ${clipList(newsList(days.yesterday, { abs: true }), 10)}
</div>`;
}

function topicsBox(cats, days, state, now) {
  const tabs = [...cats.map((c) => ({ id: c.id, name: c.short ?? c.name })), { id: 'daily', name: '今日・昨日' }];
  return `<section class="box topics" id="topics">
  <nav class="topic-tabs">${tabs.map((t) =>
    `<a href="#${t.id}" data-tab="${t.id}">${escapeHtml(t.name)}</a>`).join('')}</nav>
  <p class="topics-meta">${formatJst(state.newsAt)} 更新</p>
  ${cats.map(topicPanel).join('\n')}
  ${dailyPanel(days, now)}
</section>`;
}

// ---- 右：X と 災害 ----
function xBox() {
  const links = [
    { label: 'トレンド', url: 'https://x.com/explore/tabs/trending' },
    { label: 'ニュース', url: 'https://x.com/explore/tabs/news' },
    { label: '速報', url: xUrl(breaking.x) },
    ...categories.map((c) => ({ label: c.name, url: xUrl(c.x) })),
  ];
  return `<section class="box box-x">
  <h2 class="box-title">X（リアルタイム検索）</h2>
  <ol class="rank">${links.map((l, i) =>
    `<li><span class="rank-no">${i + 1}</span><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a></li>`).join('')}</ol>
  <p class="note">Xの最新の投稿を開きます（ログインが必要な場合があります）</p>
</section>`;
}

function disasterBox(cat, state) {
  return `<section class="box box-disaster">
  <h2 class="box-title">災害<span class="live" data-quake-status>自動更新</span></h2>
  <h3 class="sub">最近の地震</h3>
  <div data-quakes="5">${renderQuakes(state.quakes, 5)}</div>
  ${JMA_LINKS}
  <h3 class="sub">災害関連ニュース</h3>
  ${newsList(cat.items.slice(0, 5))}
  <p class="box-foot"><a class="more-link" href="#${cat.id}">もっと見る</a>${xLink(cat.x)}</p>
</section>`;
}

function page(cats, state, days, now) {
  const today = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  }).format(now);
  const sources = [...new Set([...breaking.feeds, ...cats.flatMap((c) => c.feeds)].map((f) => f.name))];
  const icon = encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📰</text></svg>");
  const iso = (ms) => new Date(ms).toISOString();
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>今日のニュース</title>
<link rel="icon" href="data:image/svg+xml,${icon}">
<link rel="stylesheet" href="style.css?v=${now}">
</head>
<body>
<header class="topbar">
  <div class="wrap topbar-inner">
    <h1 class="brand">今日のニュース</h1>
    <div class="top-meta">
      <p class="date">${today}</p>
      <p class="updated">ニュース <time data-rel datetime="${iso(state.newsAt)}">${formatJst(state.newsAt)}</time> 更新（${NEWS_INTERVAL_MIN}分ごと）
        ・ 速報 <time data-rel data-breaking-at datetime="${iso(state.breaking.at)}">${formatJst(state.breaking.at)}</time> 更新（5分ごと）</p>
    </div>
    ${TRIGGER ? `<div class="refresh-box"><button type="button" class="refresh" data-refresh="${escapeHtml(TRIGGER)}">今すぐ更新</button>
      <span class="refresh-msg" data-refresh-msg aria-live="polite"></span></div>` : ''}
  </div>
</header>
<div class="wrap layout">
  <aside class="col-left">${breakingBox(state)}</aside>
  <main class="col-main">${topicsBox(cats, days, state, now)}</main>
  <aside class="col-right">
    ${xBox()}
    ${disasterBox(cats.find((c) => c.id === 'disaster'), state)}
  </aside>
</div>
<footer class="wrap">
  <p>見出しは各配信元のRSSから自動取得しています。記事の著作権は各配信元に帰属します。</p>
  <p>出典：${sources.map(escapeHtml).join(' / ')} ／ 地震情報：P2P地震情報（気象庁発表）</p>
</footer>
<script type="module" src="app.js?v=${now}"></script>
</body>
</html>
`;
}

// ---- メイン ----

const now = Date.now();
const prev = await loadPrevState(now);
const prevCats = new Map((prev?.categories ?? []).map((c) => [c.id, c.items]));
const fullDue = FORCE_FULL || !prev?.newsAt
  || now - prev.newsAt >= (NEWS_INTERVAL_MIN - 2) * 60e3
  || categories.some((c) => !prevCats.has(c.id));

console.log(fullDue ? '全ニュースを取得中...' : '速報と地震情報を取得中...');
const [fresh, breakingItems, quakes] = await Promise.all([
  fullDue ? loadCategories(now) : null,
  loadBreaking(now, prev?.breaking?.items ?? []),
  loadQuakes(prev?.quakes),
]);

// 「主なニュース」は昨日0時以降のものを蓄積しておく
const yesterdayStart = jstDayStart(now) - DAY;
const major = uniqueSorted([...(fresh?.major ?? []), ...(prev?.major ?? [])])
  .filter((it) => it.time && it.time >= yesterdayStart && it.time <= now + 600e3);

const state = {
  newsAt: fullDue ? now : prev.newsAt,
  categories: fresh?.categories ?? categories.map((c) => ({ id: c.id, items: prevCats.get(c.id) })),
  breaking: { at: now, items: breakingItems },
  quakes,
  major,
};

const total = state.categories.reduce((n, c) => n + c.items.length, 0);
if (total === 0) {
  // 全滅のときは空のページで上書きしないよう失敗させる
  console.error('記事を1件も取得できませんでした');
  process.exit(1);
}

const cats = categories.map((c) => ({ ...c, items: state.categories.find((s) => s.id === c.id).items }));
const days = {
  today: major.filter((it) => it.time >= jstDayStart(now)),
  yesterday: major.filter((it) => it.time < jstDayStart(now)),
};

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await writeFile(new URL('index.html', DIST), page(cats, state, days, now));
await writeFile(new URL('state.json', DIST), JSON.stringify(state));
await writeFile(new URL('breaking.json', DIST), JSON.stringify(state.breaking));
for (const f of ['style.css', 'app.js', 'render.js']) {
  await copyFile(new URL(`src/${f}`, ROOT), new URL(f, DIST));
}
console.log(`完了: 速報 ${breakingItems.length}件 / 今日の主なニュース ${days.today.length}件 / 昨日 ${days.yesterday.length}件`
  + ` / ${cats.map((c) => `${c.name} ${c.items.length}件`).join(' / ')}${fullDue ? '' : '（ニュースは前回分を使用）'}`);
