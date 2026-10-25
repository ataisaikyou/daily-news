// ビルド時（Node）とブラウザの両方で使う表示用の関数

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const jstFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

// ミリ秒 → "10/25 18:07"（日本時間）
export function formatJst(ms) {
  return jstFormat.format(new Date(ms));
}

// P2P地震情報の maxScale → 震度表記
const SCALE = { 10: '1', 20: '2', 30: '3', 40: '4', 45: '5弱', 50: '5強', 55: '6弱', 60: '6強', 70: '7' };
const TSUNAMI = {
  None: '津波の心配なし',
  Unknown: '津波 不明',
  Checking: '津波 調査中',
  NonEffective: '若干の海面変動',
  Watch: '津波注意報',
  Warning: '津波予報 発表',
};

// 同じ地震の続報（震度速報→詳細）は最新の1件だけ残す。APIは新しい順に返る
function pickQuakes(list, limit) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const eq = item?.earthquake;
    if (!eq?.time || seen.has(eq.time)) continue;
    seen.add(eq.time);
    out.push(eq);
    if (out.length >= limit) break;
  }
  return out;
}

export function renderQuakes(list, limit = 10) {
  const quakes = pickQuakes(list, limit);
  if (!quakes.length) return '<p class="empty">地震情報を取得できませんでした</p>';
  const rows = quakes.map((eq) => {
    const h = eq.hypocenter ?? {};
    const scale = SCALE[eq.maxScale];
    const mag = h.magnitude > 0 ? `M${h.magnitude.toFixed(1)}` : 'M不明';
    const depth = h.depth > 0 ? `深さ${h.depth}km` : h.depth === 0 ? 'ごく浅い' : '';
    const tsunami = TSUNAMI[eq.domesticTsunami] ?? '';
    const tsunamiAlert = eq.domesticTsunami === 'Watch' || eq.domesticTsunami === 'Warning';
    return `<li class="quake">
  <span class="scale ${scale ? `s-${eq.maxScale}` : 's-unknown'}"><small>震度</small>${scale ?? '-'}</span>
  <span class="quake-body">
    <span class="quake-name">${escapeHtml(h.name || '震源 調査中')}</span>
    <span class="meta">${escapeHtml(eq.time.slice(5, 16))} ・ ${mag}${depth ? ` ・ ${depth}` : ''}${tsunami ? ` ・ <span class="${tsunamiAlert ? 'alert' : ''}">${tsunami}</span>` : ''}</span>
  </span>
</li>`;
  });
  return `<ul class="quake-list">${rows.join('')}</ul>`;
}
