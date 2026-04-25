/**
 * Shared Telegram client factory & cookie helpers
 *
 * AUTH_KEY_DUPLICATED mitigation (serverless):
 *
 * Vercel routes `/api/videos` (SSE, long-lived) and `/api/thumb` (short, concurrent)
 * to separate Lambda instances. Each instance has its own module-level cache, so both
 * may try to connect with the same session string simultaneously. Telegram detects the
 * duplicate auth key and rejects the second connection (406 AUTH_KEY_DUPLICATED).
 *
 * Fix strategy:
 *   1. Within the same instance: a promise-lock prevents multiple concurrent connects.
 *   2. Across instances: retry with exponential backoff + random jitter so thumb/stream
 *      requests wait until the SSE instance releases its connection.
 *   3. The SSE endpoint calls releaseTelegramClient() when the scan finishes so the
 *      connection slot is freed quickly.
 */
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

const clientCache = {};          // accountId → connected TelegramClient
const connectingPromises = {};   // accountId → Promise<TelegramClient>  (within-instance lock)

// ─── Cookie helpers ────────────────────────────────────────────────────────────

export function parseCookieData(req) {
  try {
    const raw = req.cookies?.tg_data;
    if (!raw) return { accounts: [], activeAccountId: null };
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return { accounts: [], activeAccountId: null };
  }
}

export function getActiveAccount(req, overrideId) {
  const data = parseCookieData(req);
  const id = overrideId || data.activeAccountId;
  return data.accounts?.find((a) => a.id === id) || null;
}

export function buildCookieHeader(data) {
  return `tg_data=${encodeURIComponent(JSON.stringify(data))}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly=false`;
}

// ─── Internal: one-shot connect ────────────────────────────────────────────────

async function _connectFresh(account) {
  const client = new TelegramClient(
    new StringSession(account.sessionString || ''),
    parseInt(account.apiId),
    account.apiHash,
    {
      connectionRetries: 3,
      retryDelay: 1000,
      useWSS: false,
    }
  );
  await client.connect();
  return client;
}

// ─── Main export ───────────────────────────────────────────────────────────────

/**
 * Get (or create) a connected TelegramClient for the given account.
 *
 * On AUTH_KEY_DUPLICATED (another Lambda instance holds the connection):
 *   Retries up to MAX_ATTEMPTS times with exponential backoff + random jitter.
 *   This gives the SSE scan time to finish and release its connection.
 */
export async function getTelegramClient(account) {
  const key = account.id;

  // 1. Within the same instance: wait for any in-flight connect
  if (connectingPromises[key]) {
    try { return await connectingPromises[key]; } catch { /* fall through */ }
  }

  // 2. Reuse cached healthy client
  if (clientCache[key]) {
    try {
      const ok = await clientCache[key].isUserAuthorized();
      if (ok) return clientCache[key];
    } catch { /* fall through */ }
    try { await clientCache[key].disconnect(); } catch {}
    delete clientCache[key];
  }

  // 3. Connect with retry (handles cross-instance AUTH_KEY_DUPLICATED)
  const MAX_ATTEMPTS = 8;
  // Backoff schedule (ms): 1 s, 2 s, 4 s, 8 s, 15 s, 20 s, 20 s, 20 s
  const BASE_DELAYS = [1000, 2000, 4000, 8000, 15000, 20000, 20000, 20000];

  const promise = (async () => {
    let lastErr;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const client = await _connectFresh(account);
        clientCache[key] = client;
        return client;
      } catch (e) {
        lastErr = e;
        const isDup =
          String(e).includes('AUTH_KEY_DUPLICATED') ||
          (e.message || '').includes('AUTH_KEY_DUPLICATED');

        if (isDup && attempt < MAX_ATTEMPTS - 1) {
          // Add random jitter so concurrent requests don't all retry together
          const base = BASE_DELAYS[attempt];
          const jitter = Math.floor(Math.random() * base * 0.5); // 0–50% of base
          const wait = base + jitter;
          console.warn(`[telegram] AUTH_KEY_DUPLICATED – retry ${attempt + 1}/${MAX_ATTEMPTS - 1} in ${wait}ms`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw e;
      } finally {
        if (connectingPromises[key] === promise) delete connectingPromises[key];
      }
    }
    throw lastErr;
  })();

  connectingPromises[key] = promise;
  return promise;
}

/**
 * Disconnect and evict the cached client for an account.
 * Called by the SSE endpoint after the scan finishes so that thumb / stream
 * requests in other Lambda instances can connect without AUTH_KEY_DUPLICATED.
 */
export async function releaseTelegramClient(account) {
  if (!account) return;
  const key = account.id;
  const client = clientCache[key];
  delete clientCache[key];
  if (client) {
    try { await client.disconnect(); } catch {}
  }
}

// ─── Login helper ──────────────────────────────────────────────────────────────

export async function createFreshClient(apiId, apiHash) {
  const client = new TelegramClient(
    new StringSession(''),
    parseInt(apiId),
    apiHash,
    { connectionRetries: 5, retryDelay: 1000 }
  );
  await client.connect();
  return client;
}

// ─── Peer / util helpers ───────────────────────────────────────────────────────

export function buildInputPeer(chatId, accessHash, chatType) {
  const { Api } = require('telegram');
  const id = BigInt(chatId);
  if (chatType === 'channel') {
    return new Api.InputPeerChannel({
      channelId: id,
      accessHash: BigInt(accessHash || '0'),
    });
  }
  if (chatType === 'chat') {
    return new Api.InputPeerChat({ chatId: id });
  }
  return Number(chatId);
}

export function bigIntReplacer(_, v) {
  return typeof v === 'bigint' ? v.toString() : v;
}

export function formatDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
