/**
 * Shared Telegram client factory & cookie helpers
 *
 * AUTH_KEY_DUPLICATED fix:
 *   A single "connecting" promise is shared across all concurrent callers for
 *   the same account. Once resolved the client is cached. This prevents multiple
 *   simultaneous connections with the same session string, which is what causes
 *   Telegram's 406 AUTH_KEY_DUPLICATED error.
 */
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

// Per-account healthy client (warm-start reuse)
const clientCache = {};
// Per-account in-flight connect promise (concurrent-request lock)
const connectingPromises = {};

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

// ─── Client factory ────────────────────────────────────────────────────────────

async function createAndConnect(account) {
  const client = new TelegramClient(
    new StringSession(account.sessionString || ''),
    parseInt(account.apiId),
    account.apiHash,
    { connectionRetries: 3, retryDelay: 1500, useWSS: false }
  );
  await client.connect();
  return client;
}

/**
 * Get (or create) a connected TelegramClient for the given account.
 *
 * Concurrent callers for the same account share a single connect promise so
 * Telegram never sees two simultaneous connections from the same auth key.
 */
export async function getTelegramClient(account) {
  const key = account.id;

  // 1. Another request is already connecting — piggyback on it
  if (connectingPromises[key]) {
    try { return await connectingPromises[key]; } catch { /* fall through */ }
  }

  // 2. Cached client — verify it's still alive
  if (clientCache[key]) {
    try {
      const ok = await clientCache[key].isUserAuthorized();
      if (ok) return clientCache[key];
    } catch { /* fall through */ }
    // Stale — disconnect cleanly before replacing
    try { await clientCache[key].disconnect(); } catch {}
    delete clientCache[key];
  }

  // 3. Build a new connection (shared promise = the lock)
  const promise = (async () => {
    try {
      const client = await createAndConnect(account);
      clientCache[key] = client;
      return client;
    } catch (e) {
      // AUTH_KEY_DUPLICATED: another instance already owns this key.
      // Wait a moment, then try once more — the other instance may have
      // finished by then, or Telegram will issue a fresh key.
      if (e.message?.includes('AUTH_KEY_DUPLICATED') || String(e).includes('AUTH_KEY_DUPLICATED')) {
        await new Promise((r) => setTimeout(r, 2500));
        const client = await createAndConnect(account);
        clientCache[key] = client;
        return client;
      }
      throw e;
    } finally {
      if (connectingPromises[key] === promise) delete connectingPromises[key];
    }
  })();

  connectingPromises[key] = promise;
  return promise;
}

/**
 * Create a fresh (unauthenticated) client for login flows
 */
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
