/**
 * GET /api/debug-stream?chatId=&msgId=&accessHash=&chatType=&accountId=
 * 診斷用：確認認證 + 訊息是否可讀取，不實際串流
 */
import { getActiveAccount, getTelegramClient, buildInputPeer } from '../../lib/telegram';

export default async function handler(req, res) {
  const { chatId, msgId, accessHash, chatType, accountId } = req.query;

  const account = getActiveAccount(req, accountId);
  if (!account) {
    return res.status(401).json({
      ok: false, step: 'auth',
      error: 'Account not found',
      accountId,
      cookiePresent: !!req.cookies?.tg_data,
    });
  }

  try {
    const client = await getTelegramClient(account);
    const peer = buildInputPeer(chatId, accessHash, chatType);
    const msgs = await client.getMessages(peer, { ids: [parseInt(msgId)] });
    const msg = msgs?.[0];

    if (!msg?.media?.document) {
      return res.json({ ok: false, step: 'message', error: 'No document found', msgFound: !!msg });
    }

    const doc = msg.media.document;
    res.json({
      ok: true,
      accountId: account.id,
      accountName: account.name,
      fileSize: Number(doc.size),
      mimeType: doc.mimeType,
      chatId, msgId, chatType,
    });
  } catch (e) {
    res.status(500).json({ ok: false, step: 'telegram', error: e.message });
  }
}
