// ブラウザ側の処理：タブ切り替え・もっと見る・相対時刻・速報と地震情報のライブ更新・今すぐ更新
import { formatJst, newsList, renderQuakes } from './render.js';

const QUAKE_API = 'https://api.p2pquake.net/v2/history?codes=551&limit=40';
const QUAKE_INTERVAL = 2 * 60 * 1000;    // 地震情報の再取得間隔
const BREAKING_INTERVAL = 60 * 1000;     // 速報データの確認間隔（更新されていれば差し替える）
const RELOAD_AFTER = 30 * 60 * 1000;  // 開きっぱなしの時、戻ってきたら再読み込みする時間
const loadedAt = Date.now();

document.documentElement.classList.add('js');

// ---- ライト／ダークの切り替え（選んだ方をこの端末に覚える。未選択なら端末の設定に従う） ----
const themeBtn = document.querySelector('[data-theme-toggle]');
const darkMq = window.matchMedia('(prefers-color-scheme: dark)');
const currentTheme = () => document.documentElement.dataset.theme || (darkMq.matches ? 'dark' : 'light');
function updateThemeBtn() {
  const dark = currentTheme() === 'dark';
  themeBtn.textContent = dark ? '☀️ ライト' : '🌙 ダーク';
  themeBtn.setAttribute('aria-label', dark ? 'ライトモードに切り替え' : 'ダークモードに切り替え');
}
if (themeBtn) {
  themeBtn.addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    // 保存できない環境（プライベートモード等）でも切り替え自体は効くので、保存の失敗は無視する
    try { localStorage.setItem('theme', next); } catch {}
    updateThemeBtn();
  });
  darkMq.addEventListener('change', updateThemeBtn);
  updateThemeBtn();
}

// ---- 中央のタブ切り替え（URLの #world などで表示するジャンルを決める。初期は「主要」） ----
const DEFAULT_TAB = 'domestic';
function showPanel() {
  const want = location.hash.slice(1) || DEFAULT_TAB;
  const id = document.querySelector(`[data-panel="${CSS.escape(want)}"]`) ? want : DEFAULT_TAB;
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('active', p.dataset.panel === id));
  document.querySelectorAll('[data-tab]').forEach((t) => {
    if (t.dataset.tab === id) {
      t.setAttribute('aria-current', 'page');
      // スマホで選択中のタブがタブ列の外に隠れないよう、横方向だけ寄せる
      const bar = t.parentElement;
      bar.scrollLeft = t.offsetLeft - (bar.clientWidth - t.offsetWidth) / 2;
    } else {
      t.removeAttribute('aria-current');
    }
  });
}
window.addEventListener('hashchange', () => {
  showPanel();
  // 右の「もっと見る」などから切り替えたとき、タブの枠が画面外なら見える位置まで移動する
  const box = document.getElementById('topics');
  const top = box.getBoundingClientRect().top;
  if (top < 0 || top > window.innerHeight * 0.6) box.scrollIntoView({ block: 'start' });
});
showPanel();

// ---- 「もっと見る」（先頭の数件だけ見せている一覧を開閉する） ----
function updateMoreButtons() {
  document.querySelectorAll('.clip').forEach((clip) => {
    const open = clip.classList.contains('open');
    const btn = clip.nextElementSibling;
    // 画面幅によって絞る件数が変わるので、実際に隠れている記事があるかで判断する
    const hidden = [...clip.querySelectorAll('.news-list > li')].some((li) => getComputedStyle(li).display === 'none');
    btn.classList.toggle('show', open || hidden);
    btn.textContent = open ? '閉じる' : 'もっと見る';
  });
}
window.matchMedia('(max-width: 767px)').addEventListener('change', updateMoreButtons);
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-more]');
  if (!btn) return;
  btn.previousElementSibling.classList.toggle('open');
  updateMoreButtons();
});
updateMoreButtons();

// ---- 「15分前」などの相対時刻 ----
function updateRelativeTimes() {
  document.querySelectorAll('time[data-rel]').forEach((el) => {
    const t = Date.parse(el.getAttribute('datetime'));
    const min = Math.floor((Date.now() - t) / 60000);
    el.title = formatJst(t);
    if (min < 1) el.textContent = 'たった今';
    else if (min < 60) el.textContent = `${min}分前`;
    else if (min < 24 * 60) el.textContent = `${Math.floor(min / 60)}時間前`;
    else el.textContent = formatJst(t);
  });
}
updateRelativeTimes();
setInterval(updateRelativeTimes, 60 * 1000);

// ---- 地震情報のライブ更新 ----
async function refreshQuakes() {
  const status = document.querySelector('[data-quake-status]');
  try {
    const res = await fetch(QUAKE_API, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const list = await res.json();
    document.querySelectorAll('[data-quakes]').forEach((el) => {
      el.innerHTML = renderQuakes(list, Number(el.dataset.quakes));
    });
    if (status) status.textContent = `${formatJst(Date.now())} 時点・自動更新`;
  } catch {
    if (status) status.textContent = '更新に失敗（ページ生成時の情報を表示中）';
  }
}
refreshQuakes();
setInterval(() => { if (!document.hidden) refreshQuakes(); }, QUAKE_INTERVAL);

// ---- 速報のライブ更新（サイト側の breaking.json は5分ごとに作り直される） ----
async function refreshBreaking() {
  try {
    const res = await fetch(`breaking.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    const atEl = document.querySelector('[data-breaking-at]');
    if (atEl && Date.parse(atEl.getAttribute('datetime')) >= data.at) return; // 変化なし
    document.querySelectorAll('[data-breaking]').forEach((el) => {
      el.innerHTML = newsList(data.items.slice(0, Number(el.dataset.breaking)));
    });
    atEl?.setAttribute('datetime', new Date(data.at).toISOString());
    updateRelativeTimes();
    updateMoreButtons();
  } catch {
    // 取得できなければ表示中の内容のまま
  }
}
setInterval(() => { if (!document.hidden) refreshBreaking(); }, BREAKING_INTERVAL);

// ---- 「今すぐ更新」ボタン（Worker 経由で全ニュース更新を起動し、終わったら読み直す） ----
const REFRESH_POLL = 5000;            // 進み具合を確認する間隔
const REFRESH_TIMEOUT = 4 * 60 * 1000; // これ以上かかったら失敗扱い
const refreshBtn = document.querySelector('[data-refresh]');
const refreshMsg = document.querySelector('[data-refresh-msg]');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, init) {
  const res = await fetch(url, { cache: 'no-store', ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function runRefresh() {
  const base = refreshBtn.dataset.refresh.replace(/\/$/, '');
  const say = (t) => { refreshMsg.textContent = t; };
  refreshBtn.disabled = true;
  try {
    say('更新を依頼しています…');
    const { since } = await fetchJson(`${base}/refresh`, { method: 'POST' });
    const started = Date.now();
    while (Date.now() - started < REFRESH_TIMEOUT) {
      await sleep(REFRESH_POLL);
      const st = await fetchJson(`${base}/status?since=${since}`);
      if (st.state === 'completed') {
        if (st.conclusion !== 'success') throw new Error(st.conclusion);
        say('更新できました。読み直します…');
        await sleep(3000);
        // ?r= を付けて、キャッシュされた古いページではなく最新のページを読む
        location.replace(`${location.pathname}?r=${Date.now()}${location.hash}`);
        return;
      }
      say(`ニュースを取得中…（${Math.round((Date.now() - started) / 1000)}秒）`);
    }
    throw new Error('timeout');
  } catch {
    say('更新できませんでした。少し待ってからもう一度お試しください');
    refreshBtn.disabled = false;
  }
}
refreshBtn?.addEventListener('click', runRefresh);

// ---- しばらく経ってからタブに戻ってきたら最新のページを読み直す ----
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - loadedAt > RELOAD_AFTER) location.reload();
});
