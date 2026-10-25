// 「人気順」の注目度：はてなブックマーク数と、同じ話題を報じた媒体の数から点数を付ける

const HATENA_API = 'https://bookmark.hatenaapis.com/count/entries';
const HATENA_MAX_URLS = 50;       // 1回の問い合わせで指定できるURLの数
const HATENA_MAX_QUERY = 6000;    // URLが長くなりすぎないよう1回の問い合わせの長さを抑える
const SIMILAR = 0.4;              // 見出しがこれ以上似ていれば同じ話題とみなす（文字2-gramのDice係数）
export const POPULAR_HOURS = 24;  // 人気順に出す記事の範囲（現在から何時間以内か）

// 見出しを比べやすい形にする（【速報】などの括弧書き・記号・空白を除く）
function normalize(title) {
  return title.normalize('NFKC')
    .replace(/[【［\[＜<〈《(（][^】］\]＞>〉》)）]{0,12}[】］\]＞>〉》)）]/g, '')
    .replace(/[\s「」『』、。・，．,.:：;；!！?？"'“”‘’…―\-ー〜~|｜/／]/g, '')
    .toLowerCase();
}

function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const g of a) if (b.has(g)) common++;
  return (2 * common) / (a.size + b.size);
}

// はてなブックマーク数を取得する。失敗した分は前回の数を使う（prev: URL → 数）
export async function fetchBookmarks(urls, prev, ua) {
  // Googleニュース経由のURLは元記事と別のURLなのでブックマークが付かない
  const targets = [...new Set(urls)].filter((u) => !u.startsWith('https://news.google.com/'));
  const batches = [];
  let batch = [];
  let len = 0;
  for (const u of targets) {
    const part = `url=${encodeURIComponent(u)}&`;
    if (batch.length && (batch.length >= HATENA_MAX_URLS || len + part.length > HATENA_MAX_QUERY)) {
      batches.push(batch);
      batch = [];
      len = 0;
    }
    batch.push(u);
    len += part.length;
  }
  if (batch.length) batches.push(batch);

  const counts = new Map();
  let failed = 0;
  await Promise.all(batches.map(async (list) => {
    try {
      const q = list.map((u) => `url=${encodeURIComponent(u)}`).join('&');
      const res = await fetch(`${HATENA_API}?${q}`, { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      for (const u of list) counts.set(u, Number(data[u]) || 0);
    } catch (e) {
      failed++;
      console.warn(`  ✗ はてなブックマーク数: ${e.message}（前回の数を使います）`);
      for (const u of list) if (prev.has(u)) counts.set(u, prev.get(u));
    }
  }));
  if (!failed) console.log(`  ✓ はてなブックマーク数: ${targets.length}件`);
  return counts;
}

// 同じ話題を報じた媒体の数（自分を含む）を数える。pool は比べる相手の記事（全ジャンル＋速報）
export function countSources(items, pool) {
  const grams = new Map();
  const gramsOf = (it) => {
    if (!grams.has(it)) grams.set(it, bigrams(normalize(it.title)));
    return grams.get(it);
  };
  return items.map((it) => {
    const sources = new Set([it.source]);
    for (const other of pool) {
      if (other === it || sources.has(other.source)) continue;
      if (dice(gramsOf(it), gramsOf(other)) >= SIMILAR) sources.add(other.source);
    }
    return sources.size;
  });
}

// 注目度の点数：報じた媒体が1つ増えるごとに2点、ブックマーク数は対数で加点
export function popularityScore({ hb = 0, src = 1 }) {
  return (src - 1) * 2 + Math.log2(1 + hb);
}

// 人気順の一覧：現在から POPULAR_HOURS 時間以内の記事を点数の高い順（同点は新しい順）に並べる
export function popularOrder(items, now) {
  return items
    .filter((it) => it.time && now - it.time <= POPULAR_HOURS * 3600e3)
    .map((it) => ({ it, score: popularityScore(it) }))
    .sort((a, b) => b.score - a.score || b.it.time - a.it.time)
    .map(({ it }) => it);
}
