/**
 * GET  /api/accounts         — list all accounts from cookie
 * POST /api/accounts/switch  — switch active account  { id }
 * POST /api/accounts/logout  — remove account from cookie  { id }
 */
import { parseCookieData, buildCookieHeader } from '../../lib/telegram';

export default function handler(req, res) {
  const { method, query, body } = req;

  if (method === 'GET') {
    const data = parseCookieData(req);
    const accounts = (data.accounts || []).map(({ id, name, phone }) => ({
      id,
      name,
      phone,
      active: id === data.activeAccountId,
    }));
    return res.json({ accounts, activeAccountId: data.activeAccountId });
  }

  if (method === 'POST') {
    const { action } = query;
    const data = parseCookieData(req);
    let accounts = data.accounts || [];

    if (action === 'switch') {
      const { id } = body || {};
      if (!accounts.find((a) => a.id === id)) {
        return res.status(404).json({ error: 'Account not found' });
      }
      data.activeAccountId = id;
      res.setHeader('Set-Cookie', buildCookieHeader(data));
      return res.json({ success: true });
    }

    if (action === 'logout') {
      const { id } = body || {};
      accounts = accounts.filter((a) => a.id !== id);
      const activeId = data.activeAccountId === id
        ? (accounts[0]?.id || null)
        : data.activeAccountId;
      const newData = { accounts, activeAccountId: activeId };
      res.setHeader('Set-Cookie', buildCookieHeader(newData));
      return res.json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action. Use ?action=switch or ?action=logout' });
  }

  res.status(405).end();
}
