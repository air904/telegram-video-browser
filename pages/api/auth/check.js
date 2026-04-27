/**
 * GET /api/auth/check?accountId=xxx
 *
 * 檢查指定帳號的 Telegram session 是否仍然有效。
 * 切換帳號後呼叫，若 session 已失效（授權過期）則前端顯示重新登入流程。
 *
 * Returns:
 *   { authorized: true,  phone: '+886...' }
 *   { authorized: false, phone: '+886...', reason: '...' }
 */
import { getActiveAccount, getTelegramClient, releaseTelegramClient } from '../../../lib/telegram';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { accountId } = req.query;
  const account = getActiveAccount(req, accountId);

  if (!account) {
    return res.status(200).json({ authorized: false, reason: 'account_not_found', phone: null });
  }

  try {
    const client = await getTelegramClient(account);
    const authorized = await client.isUserAuthorized();

    if (!authorized) {
      // Session string is invalid — evict from cache so it doesn't pollute future calls
      await releaseTelegramClient(account);
    }

    return res.status(200).json({ authorized, phone: account.phone });
  } catch (e) {
    console.error('[auth/check] error:', e.message);
    // Any connection or auth error → treat as not authorized
    await releaseTelegramClient(account).catch(() => {});
    return res.status(200).json({ authorized: false, reason: e.message, phone: account.phone });
  }
}
