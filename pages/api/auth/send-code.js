/**
 * POST /api/auth/send-code
 * Body: { apiId, apiHash, phone }
 * Returns: { phoneCodeHash }
 *
 * Creates a fresh Telegram client, requests an OTP, and returns the phoneCodeHash.
 * The client is disconnected after; the stateless phoneCodeHash is passed back to
 * the browser so verify-code can complete the flow from a fresh connection.
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

    res.json({ success: true, phoneCodeHash: result.phoneCodeHash });
  } catch (e) {
    res.status(400).json({ error: e.message });
  } finally {
    try { await client?.disconnect(); } catch {}
  }
}
