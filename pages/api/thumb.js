/**
 * GET /api/thumb?chatId=&msgId=&accessHash=&chatType=&accountId=
 *
 * Downloads and returns the thumbnail of a Telegram video message.
 * Response is cached in the browser for 24 hours.
 */
import {
  getActiveAccount,
  getTelegramClient,
  buildInputPeer,
} from '../../lib/telegram';

export const config = { api: { responseLimit: false } };

// In-memory thumbnail cache (persists across warm-start requests in the same instance)
const thumbCache = new Map(); // key → Buffer

export default async function handler(req, res) {
  const { chatId, msgId, accessHash, chatType, accountId } = req.query;
  const account = getActiveAccount(req, accountId);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });

  const cacheKey = `${account.id}_${chatId}_${msgId}`;

  // Serve from in-memory cache if available
  if (thumbCache.has(cacheKey)) {
    const buf = thumbCache.get(cacheKey);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    return res.send(buf);
  }

  try {
    const client = await getTelegramClient(account);
    const peer = buildInputPeer(chatId, accessHash, chatType);
    const msgs = await client.getMessages(peer, { ids: [parseInt(msgId)] });
    const msg = msgs?.[0];

    if (!msg?.media?.document) {
      return res.status(404).send('Media not found');
    }

    const doc = msg.media.document;
    if (!doc.thumbs || doc.thumbs.length === 0) {
      return res.status(404).send('No thumbnail');
    }

    // Download smallest thumbnail
    const thumbBuffer = await client.downloadMedia(msg, { thumb: 0 });

    if (!thumbBuffer || thumbBuffer.length === 0) {
      return res.status(404).send('Empty thumbnail');
    }

    // Cache in memory (cap at 500 entries to prevent unbounded growth)
    if (thumbCache.size >= 500) {
      const firstKey = thumbCache.keys().next().value;
      thumbCache.delete(firstKey);
    }
    thumbCache.set(cacheKey, thumbBuffer);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.send(thumbBuffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
