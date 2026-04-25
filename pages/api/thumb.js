/**
 * GET /api/thumb?chatId=&msgId=&accessHash=&chatType=&accountId=
 *
 * 下載 Telegram 影片縮圖（自動選最高畫質）。
 * 瀏覽器端快取 24 小時。
 */
import { getActiveAccount, getTelegramClient, buildInputPeer } from '../../lib/telegram';

export const config = { api: { responseLimit: false } };

// In-memory cache (warm-start across requests in same instance)
const thumbCache = new Map();

export default async function handler(req, res) {
  const { chatId, msgId, accessHash, chatType, accountId } = req.query;
  const account = getActiveAccount(req, accountId);
  if (!account) return res.status(401).end('Not authenticated');

  const cacheKey = `${account.id}_${chatId}_${msgId}`;

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

    if (!msg?.media?.document) return res.status(404).end('Not found');

    const doc = msg.media.document;
    const thumbs = doc.thumbs || [];
    if (thumbs.length === 0) return res.status(404).end('No thumbnail');

    // 選最高畫質：找面積最大的 PhotoSize（排除漸進式/路徑類型）
    let bestIdx = thumbs.length - 1;
    let bestArea = 0;
    for (let i = 0; i < thumbs.length; i++) {
      const t = thumbs[i];
      const area = (t.w || 0) * (t.h || 0);
      if (t.className === 'PhotoSize' && area > bestArea) {
        bestArea = area;
        bestIdx = i;
      }
    }

    const thumbBuffer = await client.downloadMedia(msg, { thumb: bestIdx });
    if (!thumbBuffer || thumbBuffer.length === 0) return res.status(404).end('Empty thumbnail');

    // 最多快取 600 筆
    if (thumbCache.size >= 600) thumbCache.delete(thumbCache.keys().next().value);
    thumbCache.set(cacheKey, thumbBuffer);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    res.send(thumbBuffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
