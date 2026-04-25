/**
 * POST /api/auth/verify-2fa
 * Body: { apiId, apiHash, phone, partialSession, password }
 *
 * Resumes the partially-authenticated session returned by verify-code
 * and completes the 2FA check.
 */
import { Api } from 'telegram';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { saveSessionAndSetCookie } from './verify-code';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { apiId, apiHash, phone, partialSession, password } = req.body || {};
  if (!apiId || !apiHash || !phone || !partialSession || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let client;
  try {
    // Resume the partial session (preserves auth keys for 2FA)
    client = new TelegramClient(
      new StringSession(partialSession),
      parseInt(apiId),
      apiHash,
      { connectionRetries: 5, retryDelay: 1000 }
    );
    await client.connect();

    // Compute SRP password check
    const { computeCheck } = await import('telegram/Password');
    const passwordInfo = await client.invoke(new Api.account.GetPassword());
    const srp = await computeCheck(passwordInfo, password);
    const result = await client.invoke(new Api.auth.CheckPassword({ password: srp }));

    await saveSessionAndSetCookie({
      client,
      user: result.user,
      apiId,
      apiHash,
      phone,
      req,
      res,
    });
  } catch (e) {
    try { await client?.disconnect(); } catch {}
    res.status(400).json({ error: e.message });
  }
}
