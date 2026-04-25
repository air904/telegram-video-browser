/**
 * Shared Telegram client factory & cookie helpers
 * Module-level cache persists within the same Vercel function instance (warm starts).
 */
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';

// Per-account client cache (warm-start optimization)
const clientCache = {};

/**
 * Parse the tg_data cookie from the request
 */
export function parseCookieData(req) {
  try {
    const raw = req.cookies?.tg_data;
    if (!raw) return { accounts: [], activeAccountId: null };
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return { accounts: [], activeAccountId: null };
  }
}

/**
 * Get the currently active account object from cookie
 */
export function getActiveAccount(req, overrideId) {
  const data = parseCookieData(req);
  const id = overrideId || data.activeAccountId;
  return data.accounts?.find((a) => a.id === id) || null;
}

/**
 * Serialize cookie header value
 */
export function buildCookieHeader(data) {
  return `tg_data=${encodeURIComponent(JSON.stringify(data))}; Path=/; Max-Age=2592000; SameSite=Lax; HttpOnly=false`;
}

/**
 * Get (or create) a connected TelegramClient for the given account.
 * Reuses cached client on warm starts.
 */
export async function getTelegramClient(account) {
  const key = account.id;

  if (clientCache[key]) {
    try {
      const ok = await clientCache[key].isUserAuthorized();
      if (ok) return clientCache[key];
    } catch {
      // Fall through to reconnect
    }
    delete clientCache[key];
  }

  const client = new TelegramClient(
    new StringSession(account.sessionString || ''),
    parseInt(account.apiId),
    account.apiHash,
    {
      connectionRetries: 5,
      retryDelay: 1000,
      // useWSS: true  -- uncomment if TCP fails in Vercel
    }
  );

  await client.connect();
  clientCache[key] = client;
  return client;
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

/**
 * Build an InputPeer for getMessages based on chat metadata
 */
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
  // Fallback: try as integer
  return Number(chatId);
}

/**
 * JSON replacer that converts BigInt → string (Telegram uses BigInt for IDs)
 */
export function bigIntReplacer(_, v) {
  return typeof v === 'bigint' ? v.toString() : v;
}

/**
 * Format seconds into mm:ss
 */
export function formatDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format bytes to human-readable
 */
export function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
