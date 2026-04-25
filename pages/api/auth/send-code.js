/**
 * POST /api/auth/send-code
 * Body: { apiId, apiHash, phone }
 * Returns: { phoneCodeHash, sessionAfterCode }
 *
 * Creates a fresh Telegram client, requests an OTP.
 * IMPORTANT: We save the session string (which contains DC routing info) and
 * return it as `sessionAfterCode`. verify-code MUST use this session so it
 * connects to the same Telegram DC — otherwise the code appears "expired".
 */
import { createFreshClient } from '../../../lib/telegram';
import { Api } from 'telegram';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { apiId, apiHash, phone } = req.body || {};
  if (!apiId || !apiHash || !phone) {
    return res.status(400).json({ error: 'apiId, apiHash and phone are required' });
  }

  let client;
  try {
    client = await createFreshClient(apiId, apiHash);

    const result = await client.invoke(
      new Api.auth.SendCode({
        phoneNumber: phone,
        apiId: parseInt(apiId),
        apiHash,
        settings: new Api.CodeSettings({}),
      })
    );

    // Save DC-aware session so verify-code can reconnect to the same server
    const sessionAfterCode = client.session.save();

    res.json({
      success: true,
      phoneCodeHash: result.phoneCodeHash,
      sessionAfterCode,           // ← pass DC session to frontend
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    try { await client?.disconnect(); } catch {}
  }
}
