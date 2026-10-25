// GitHub Actions の「ニュース更新」を確実に動かすための Cloudflare Worker
// - 5分の倍数の時刻（Cron Trigger）にワークフローを起動する（GitHub の定期実行は遅延・欠落が多いため）
//   毎時0分・30分は全ニュース、それ以外は速報と地震情報だけを取り直す
// - サイトの「今すぐ更新」ボタンから POST /refresh で全ニュースの取り直し（手動更新）を起動する
// - GET /status?since=ミリ秒 で、その時刻以降に起動した手動更新の進み具合を返す

// ワークフローの run-name と合わせる
const MANUAL_TITLE = '手動更新';
const BREAKING_TITLE = '速報更新';
const WAITING = new Set(['requested', 'queued', 'pending', 'waiting']);
const ACTIVE = new Set([...WAITING, 'in_progress']);
const MANUAL_SKIP_MS = 4 * 60e3; // 手動更新からこの時間以内の5分更新は見送る

async function github(env, path, init = {}) {
  const res = await fetch(`${env.GITHUB_API}/repos/${env.REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'daily-news-trigger',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// full: 全ニュースを取り直す / manual: 手動更新 / at: 定期更新の予定時刻（更新時刻として記録する）
function dispatch(env, { full, manual = false, at = '' }) {
  return github(env, `/actions/workflows/${env.WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { full: String(full), manual: String(manual), at: String(at) } }),
  });
}

async function recentRuns(env) {
  const data = await github(env, `/actions/workflows/${env.WORKFLOW}/runs?per_page=10`);
  return data.workflow_runs.map((r) => ({
    title: r.display_title,
    status: r.status,
    conclusion: r.conclusion,
    createdAt: Date.parse(r.created_at),
  }));
}

function corsHeaders(env, request) {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
  return allowed.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin' }
    : null;
}

function json(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors },
  });
}

async function handleRefresh(env) {
  // すでに手動更新が動いている（待機中を含む）なら重ねて起動しない
  const runs = await recentRuns(env);
  const running = runs.find((r) => r.title === MANUAL_TITLE && ACTIVE.has(r.status));
  if (running) return { state: 'running', since: running.createdAt };
  const since = Date.now();
  await dispatch(env, { full: true, manual: true });
  return { state: 'started', since };
}

async function handleStatus(env, since) {
  // 起動直後は一覧に出るまで数秒かかるので、少し前からの実行も対象にする
  const run = (await recentRuns(env)).find((r) => r.title === MANUAL_TITLE && r.createdAt >= since - 15000);
  if (!run) return { state: 'waiting' };
  return { state: run.status, conclusion: run.conclusion };
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      // 予定時刻を5分の倍数にそろえる（念のため。秒がずれていても0分・30分の判定を誤らない）
      const at = Math.round(controller.scheduledTime / 300e3) * 300e3;
      const full = (at / 60e3) % Number(env.FULL_EVERY_MIN) === 0;
      const runs = await recentRuns(env);
      // 待機中の実行があるときは見送る（後から起動すると、待機中のものが置き換えられてしまうため）。
      // ただし待機中が速報更新で、今回が全ニュース更新なら置き換えてよい
      if (runs.some((r) => WAITING.has(r.status) && (r.title !== BREAKING_TITLE || !full))) return;
      // 5分更新は、直前4分以内に手動更新があれば見送る
      if (!full && runs.some((r) => r.title === MANUAL_TITLE && at - r.createdAt <= MANUAL_SKIP_MS)) return;
      await dispatch(env, { full, at });
    })());
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: cors ? 204 : 403, headers: cors ?? {} });
    // 許可したサイト以外からの呼び出しは断る
    if (!cors) return json({ error: 'forbidden' }, 403, {});
    try {
      if (request.method === 'POST' && url.pathname === '/refresh') {
        return json(await handleRefresh(env), 202, cors);
      }
      if (request.method === 'GET' && url.pathname === '/status') {
        return json(await handleStatus(env, Number(url.searchParams.get('since')) || 0), 200, cors);
      }
      return json({ error: 'not found' }, 404, cors);
    } catch (e) {
      console.error(e);
      return json({ error: 'GitHub の呼び出しに失敗しました' }, 502, cors);
    }
  },
};
