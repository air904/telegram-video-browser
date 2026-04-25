/**
 * POST /api/auth/verify-code
 * Body: { apiId, apiHash, phone, phoneCodeHash, code }
 * Returns:
 *   - { success, account }          on success
 *   - { needsPassword, partialSession } if 2FA is required
 *
 * If 2FA is required the partially-authenticated session string is returned
 * so verify-2fa can resume on the same cryptographic session.
 */
import { parseCookieData, buildCookieHeader } from '../../../lib/telegram';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { apiId, apiHash, phone, phoneCodeHash, code, sessionAfterCode } = req.body || {};
  if (!apiId || !apiHash || !phone || !phoneCodeHash || !code) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  let client;
  try {
    // Use the DC-aware session from send-code so we hit the same Telegram server.
    // Falling back to empty session risks DC mismatch → PHONE_CODE_EXPIRED.
    client = new TelegramClient(
      new StringSession(sessionAfterCode || ''),
      parseInt(apiId),
      apiHash,
      { connectionRetries: 5, retryDelay: 1000 }
    );
    await client.connect();

    let user;
    try {
      const result = await client.invoke(
        new Api.auth.SignIn({
          phoneNumber: phone,
          phoneCodeHash,
          phoneCode: code,
        })
      );
      user = result.user;
    } catch (e) {
      if (e.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        // Serialize partial session so verify-2fa can resume it
        const partialSession = client.session.save();
        // Keep client connected (needed for 2FA) — caller must call disconnect via verify-2fa
        return res.json({ needsPassword: true, partialSession });
      }
      throw e;
    }

    // Fully logged in — save session and set cookie
    await saveSessionAndSetCookie({ client, user, apiId, apiHash, phone, req, res });
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    // Only disconnect if we didn't hand off to 2FA
    if (client && !res.headersSent) {
      try { await client.disconnect(); } catch {}
    }
  }
}

export async function saveSessionAndSetCookie({ client, user, apiId, apiHash, phone, req, res }) {
  const sessionString = client.session.save();
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || phone;
  // Deterministic ID based on phone
  const id = crypto.createHash('md5').update(phone).digest('hex').slice(0, 12);

  try { await client.disconnect(); } catch {}

  const existing = parseCookieData(req);
  const accounts = existing.accounts || [];
  const idx = accounts.findIndex((a) => a.id === id);
  const account = { id, name, phone, apiId: parseInt(apiId), apiHash, sessionString };

  if (idx >= 0) accounts[idx] = account;
  else accounts.push(account);

  const newData = { accounts, activeAccountId: id };
  res.setHeader('Set-Cookie', buildCookieHeader(newData));
  res.json({ success: true, account: { id, name, phone } });
}
