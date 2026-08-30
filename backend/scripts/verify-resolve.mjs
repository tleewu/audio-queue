#!/usr/bin/env node
/**
 * End-to-end check of what production actually does with a link.
 *
 * Creates a throwaway anonymous account, adds each URL, prints what resolution
 * produced, then deletes the account and everything in it. Nothing touches a
 * real user's queue.
 *
 *   node scripts/verify-resolve.mjs <url> [url...]
 *   API_BASE=http://localhost:8080 node scripts/verify-resolve.mjs <url>
 *
 * Add --debug to also call GET /api/debug/resolve, which reports what the
 * server sees for the page (needs DEBUG_RESOLVE=1 set on the server).
 */

const API_BASE = process.env.API_BASE ?? 'https://audio-queue-production.up.railway.app';
const args = process.argv.slice(2);
const useDebug = args.includes('--debug');
const urls = args.filter((a) => !a.startsWith('--'));

if (urls.length === 0) {
  console.error('usage: node scripts/verify-resolve.mjs [--debug] <url> [url...]');
  process.exit(1);
}

/** Random per-run id so runs never collide or reuse an account. */
function throwawayDeviceId() {
  return `verify-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function api(path, { method = 'GET', token, body } = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await resp.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text.slice(0, 300);
  }
  return { status: resp.status, ok: resp.ok, body: parsed };
}

const main = async () => {
  console.log(`base: ${API_BASE}`);

  const health = await api('/health');
  console.log(`health: ${health.status}`);
  if (!health.ok) {
    console.error('server is not healthy — stopping before creating anything');
    process.exit(1);
  }

  const session = await api('/api/auth/device', {
    method: 'POST',
    body: { deviceId: throwawayDeviceId() },
  });
  if (!session.ok || !session.body?.token) {
    console.error('could not create throwaway account:', session.status, session.body);
    process.exit(1);
  }
  const token = session.body.token;
  console.log(`throwaway account: ${session.body.user?.id ?? '?'}\n`);

  let failures = 0;
  try {
    for (const url of urls) {
      console.log(`── ${url}`);

      if (useDebug) {
        const dbg = await api(`/api/debug/resolve?url=${encodeURIComponent(url)}`, { token });
        console.log(`   debug ${dbg.status}: ${JSON.stringify(dbg.body)}`);
      }

      const added = await api('/api/queue', { method: 'POST', token, body: { url } });
      if (!added.ok) {
        console.log(`   ADD FAILED ${added.status}: ${JSON.stringify(added.body)}\n`);
        failures++;
        continue;
      }

      const item = added.body;
      const isPodcast = Boolean(item.audioURL);
      const titledByUrl = item.title === url;
      console.log(`   title    : ${JSON.stringify(item.title)}${titledByUrl ? '   <-- UNRESOLVED (titled by its own URL)' : ''}`);
      console.log(`   publisher: ${JSON.stringify(item.publisher)}`);
      console.log(`   outcome  : ${isPodcast ? `PODCAST (${item.durationSeconds ?? '?'}s)` : 'web item'}`);
      console.log('');
      if (titledByUrl) failures++;
    }
  } finally {
    const deleted = await api('/api/auth/account', { method: 'DELETE', token });
    console.log(`cleanup: deleted throwaway account (${deleted.status})`);
  }

  process.exit(failures > 0 ? 1 : 0);
};

main().catch((err) => {
  console.error('verify-resolve failed:', err);
  process.exit(1);
});
