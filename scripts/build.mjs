// RSSと地震情報を取得して dist/ に静的サイトを生成する
import { XMLParser } from 'fast-xml-parser';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { categories, quakeApi } from '../feeds.mjs';
import { escapeHtml, formatJst, renderQuakes } from '../src/render.js';

const ROOT = new URL('../', import.meta.url);
const DIST = new URL('dist/', ROOT);
const UA = 'Mozilla/5.0 (compatible; daily-news/1.0; +https://github.com/ataisaikyou/daily-news)';
const MAX_AGE_HOURS = 48; // これより古い記事は出さない
const MAX_ITEMS = 40;     // カテゴリごとの最大件数
const SUMMARY_ITEMS = 5;  // 「まとめ」に出す件数

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  htmlEntities: true,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'link',
});

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

// 重複を除いて新しい順に並べ、古すぎる記事を落とす
function pickItems(items, now) {
  const seen = new Set();
  const unique = items.filter((it) => {
    if (!it.title || !/^https?:\/\//.test(it.link)) return false;
    const key = it.title.replace(/\s/g, '');
    if (seen.has(it.link) || seen.has(key)) return false;
    seen.add(it.link);
    seen.add(key);
    return true;
  });
  unique.sort((a, b) => (b.time ?? 0) - (a.time ?? 0));
  const fresh = unique.filter((it) => it.time && now - it.time <= MAX_AGE_HOURS * 3600e3);
  // 新しい記事が少ないフィードでも空にならないよう、最低10件は出す
  return (fresh.length >= 10 ? fresh : unique.slice(0, 10)).slice(0, MAX_ITEMS);
}

async function loadCategories(now) {
  const jobs = categories.flatMap((cat) => cat.feeds.map(async (feed) => {
    try {
      const items = parseFeed(await fetchText(feed.url), feed.name);
      console.log(`  ✓ [${cat.name}] ${feed.name}: ${items.length}件`);
      return { cat: cat.id, items };
    } catch (e) {
      console.warn(`  ✗ [${cat.name}] ${feed.name}: ${e.message} (${feed.url})`);
      return { cat: cat.id, items: [] };
    }
  }));
  const results = await Promise.all(jobs);
  return categories.map((cat) => ({
    ...cat,
    items: pickItems(results.filter((r) => r.cat === cat.id).flatMap((r) => r.items), now),
  }));
}

async function loadQuakes() {
  try {
    const res = await fetch(quakeApi, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = await res.json();
    console.log(`  ✓ 地震情報: ${list.length}件`);
    return list;
  } catch (e) {
    console.warn(`  ✗ 地震情報: ${e.message}`);
    return [];
  }
}

// ---- HTML 生成 ----

function newsList(items) {
  if (!items.length) return '<p class="empty">記事を取得できませんでした</p>';
  return `<ul class="news-list">${items.map((it) => `
  <li><a href="${escapeHtml(it.link)}" target="_blank" rel="noopener">${escapeHtml(it.title)}</a>
    <span class="meta">${escapeHtml(it.source)}${it.time ? ` ・ <time data-rel datetime="${new Date(it.time).toISOString()}">${formatJst(it.time)}</time>` : ''}</span></li>`).join('')}
</ul>`;
}

function cardHead(cat, label = cat.name) {
  return `<div class="card-head">
  <h2><span class="dot"></span>${escapeHtml(label)}</h2>
  <a class="more" href="#${cat.id}">すべて見る →</a>
</div>`;
}

const JMA_LINKS = `<p class="links">
  <a href="https://www.jma.go.jp/bosai/warning/" target="_blank" rel="noopener">気象庁 警報・注意報</a>
  <a href="https://www.jma.go.jp/bosai/map.html#contents=earthquake_map" target="_blank" rel="noopener">気象庁 地震情報</a>
  <a href="https://www.jma.go.jp/bosai/map.html#contents=tsunami" target="_blank" rel="noopener">気象庁 津波情報</a>
</p>`;

function summaryPanel(cats, quakes) {
  const cards = cats.map((cat) => {
    if (cat.id === 'disaster') {
      return `<article class="card cat-${cat.id}">
${cardHead(cat)}
<h3 class="sub">最近の地震</h3>
<div data-quakes="3">${renderQuakes(quakes, 3)}</div>
<h3 class="sub">災害関連ニュース</h3>
${newsList(cat.items.slice(0, 3))}
</article>`;
    }
    return `<article class="card cat-${cat.id}">
${cardHead(cat)}
${newsList(cat.items.slice(0, SUMMARY_ITEMS))}
</article>`;
  });
  return `<section class="panel" data-panel="summary"><div class="cards">${cards.join('\n')}</div></section>`;
}

function categoryPanel(cat, quakes) {
  if (cat.id === 'disaster') {
    return `<section class="panel cat-${cat.id}" data-panel="${cat.id}">
<div class="split">
  <article class="card">
    <div class="card-head"><h2><span class="dot"></span>最近の地震</h2><span class="live" data-quake-status>自動更新</span></div>
    <div data-quakes="10">${renderQuakes(quakes, 10)}</div>
    ${JMA_LINKS}
  </article>
  <article class="card">
    <div class="card-head"><h2><span class="dot"></span>災害関連ニュース</h2></div>
    ${newsList(cat.items)}
  </article>
</div>
</section>`;
  }
  return `<section class="panel cat-${cat.id}" data-panel="${cat.id}">
<article class="card wide">
  <div class="card-head"><h2><span class="dot"></span>${escapeHtml(cat.name)}</h2><span class="count">${cat.items.length}件</span></div>
  ${newsList(cat.items)}
</article>
</section>`;
}

function page(cats, quakes, now) {
  const today = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
  }).format(now);
  const sources = [...new Set(cats.flatMap((c) => c.feeds.map((f) => f.name)))];
  const icon = encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📰</text></svg>");
  const tabs = [{ id: 'summary', name: 'まとめ' }, ...cats]
    .map((t) => `<a class="tab cat-${t.id}" href="#${t.id === 'summary' ? '' : t.id}" data-tab="${t.id}">${escapeHtml(t.name)}</a>`)
    .join('');
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
<header class="site-header">
  <div class="wrap">
    <h1>今日のニュース</h1>
    <p class="date">${today}</p>
    <p class="updated">最終更新 <time data-rel datetime="${new Date(now).toISOString()}">${formatJst(now)}</time>（1時間ごとに自動更新）</p>
  </div>
</header>
<nav class="tabs"><div class="wrap">${tabs}</div></nav>
<main class="wrap">
${summaryPanel(cats, quakes)}
${cats.map((c) => categoryPanel(c, quakes)).join('\n')}
</main>
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
console.log('ニュースを取得中...');
const [cats, quakes] = await Promise.all([loadCategories(now), loadQuakes()]);

const total = cats.reduce((n, c) => n + c.items.length, 0);
if (total === 0) {
  // 全滅のときは空のページで上書きしないよう失敗させる
  console.error('記事を1件も取得できませんでした');
  process.exit(1);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await writeFile(new URL('index.html', DIST), page(cats, quakes, now));
for (const f of ['style.css', 'app.js', 'render.js']) {
  await copyFile(new URL(`src/${f}`, ROOT), new URL(f, DIST));
}
console.log(`完了: ${cats.map((c) => `${c.name} ${c.items.length}件`).join(' / ')}`);
