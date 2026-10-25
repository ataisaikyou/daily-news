// ブラウザ側の処理：タブ切り替え・相対時刻・地震情報のライブ更新
import { formatJst, renderQuakes } from './render.js';

const QUAKE_API = 'https://api.p2pquake.net/v2/history?codes=551&limit=40';
const QUAKE_INTERVAL = 2 * 60 * 1000; // 地震情報の再取得間隔
const RELOAD_AFTER = 30 * 60 * 1000;  // 開きっぱなしの時、戻ってきたら再読み込みする時間
const loadedAt = Date.now();

document.documentElement.classList.add('js');

// ---- タブ切り替え（URLの #domestic などで表示するカテゴリを決める） ----
function showPanel() {
  const want = location.hash.slice(1) || 'summary';
  const id = document.querySelector(`[data-panel="${CSS.escape(want)}"]`) ? want : 'summary';
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('active', p.dataset.panel === id));
  document.querySelectorAll('[data-tab]').forEach((t) => {
    if (t.dataset.tab === id) {
      t.setAttribute('aria-current', 'page');
      // スマホで選択中のタブが画面外に隠れないようにする
      t.scrollIntoView({ block: 'nearest', inline: 'center' });
    } else {
      t.removeAttribute('aria-current');
    }
  });
}
window.addEventListener('hashchange', () => {
  showPanel();
  window.scrollTo({ top: 0 });
});
showPanel();

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

// ---- しばらく経ってからタブに戻ってきたら最新のページを読み直す ----
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() - loadedAt > RELOAD_AFTER) location.reload();
});
