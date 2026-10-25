// GitHub Actions の「ニュース更新」を確実に動かすための Cloudflare Worker
// - 5分ごと（Cron Trigger）にワークフローを起動する（GitHub の定期実行は遅延・欠落が多いため）
// - サイトの「今すぐ更新」ボタンから POST /refresh で全ニュースの取り直しを起動する
// - GET /status?since=ミリ秒 で、その時刻以降に起動した全ニュース更新の進み具合を返す

const FULL_TITLE = '全ニュース更新'; // ワークフローの run-name と合わせる
const ACTIVE = new Set(['requested', 'queued', 'pending', 'waiting', 'in_progress']);

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

// full: true なら30分を待たずに全ニュースを取り直す
function dispatch(env, full) {
  return github(env, `/actions/workflows/${env.WORKFLOW}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main', inputs: { full: String(full) } }),
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
  // すでに全ニュース更新が動いている（待機中を含む）なら重ねて起動しない
  const runs = await recentRuns(env);
  const running = runs.find((r) => r.title === FULL_TITLE && ACTIVE.has(r.status));
  if (running) return { state: 'running', since: running.createdAt };
  const since = Date.now();
  await dispatch(env, true);
  return { state: 'started', since };
}

async function handleStatus(env, since) {
  // 起動直後は一覧に出るまで数秒かかるので、少し前からの実行も対象にする
  const run = (await recentRuns(env)).find((r) => r.title === FULL_TITLE && r.createdAt >= since - 15000);
  if (!run) return { state: 'waiting' };
  return { state: run.status, conclusion: run.conclusion };
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil((async () => {
      // 実行中・待機中のものがあれば今回は見送る
      // （重ねて起動すると、待機中の「全ニュース更新」が後から来た定期更新に置き換えられてしまう）
      if ((await recentRuns(env)).some((r) => ACTIVE.has(r.status))) return;
      await dispatch(env, false);
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
