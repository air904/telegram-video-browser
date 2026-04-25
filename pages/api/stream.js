/**
 * GET /api/stream?chatId=&msgId=&accessHash=&chatType=&mimeType=&accountId=
 *
 * Streams a Telegram video to the browser with HTTP range request support.
 *
 * Flow:
 *  1. Download the video to /tmp (cached per serverless instance).
 *  2. Serve from /tmp with proper Content-Range so <video> seeking works.
 *
 * Note: First play of a video requires a full download — a progress event
 * stream is sent via /api/stream-progress for the UI loading indicator.
 */
import {
  getActiveAccount,
  getTelegramClient,
  buildInputPeer,
} from '../../lib/telegram';
import fs from 'fs';
import path from 'path';

export const config = { api: { responseLimit: false } };

// Track in-progress downloads: cacheKey → Promise
const inFlight = new Map();

// Export progress map so /api/stream-progress can read it
export const downloadProgress = new Map(); // cacheKey → { pct, done, error }

export default async function handler(req, res) {
  const { chatId, msgId, accessHash, chatType, mimeType = 'video/mp4', accountId } = req.query;
  const account = getActiveAccount(req, accountId);
  if (!account) return res.status(401).send('Not authenticated');

  const cacheKey = `${account.id}_${chatId}_${msgId}`;
  const ext = (mimeType.split('/')[1] || 'mp4').replace('x-matroska', 'mkv');
  const tmpPath = `/tmp/${cacheKey}.${ext}`;

  // Ensure file is downloaded
  if (!fs.existsSync(tmpPath)) {
    if (!inFlight.has(cacheKey)) {
      downloadProgress.set(cacheKey, { pct: 0, done: false, error: null });

      const promise = (async () => {
        const client = await getTelegramClient(account);
        const peer = buildInputPeer(chatId, accessHash, chatType);
        const msgs = await client.getMessages(peer, { ids: [parseInt(msgId)] });
        const msg = msgs?.[0];
        if (!msg?.media?.document) throw new Error('Media not found');

        const total = Number(msg.media.document.size || 0);

        await client.downloadMedia(msg, {
          outputFile: tmpPath,
          progressCallback: (downloaded) => {
            const pct = total > 0 ? Math.round((Number(downloaded) / total) * 100) : 0;
            downloadProgress.set(cacheKey, { pct, done: false, error: null });
          },
        });

        downloadProgress.set(cacheKey, { pct: 100, done: true, error: null });
      })().catch((err) => {
        downloadProgress.set(cacheKey, { pct: 0, done: false, error: err.message });
        inFlight.delete(cacheKey);
        throw err;
      }).finally(() => inFlight.delete(cacheKey));

      inFlight.set(cacheKey, promise);
    }

    try {
      await inFlight.get(cacheKey);
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  } else {
    // File already exists; mark progress as done
    downloadProgress.set(cacheKey, { pct: 100, done: true, error: null });
  }

  if (!fs.existsSync(tmpPath)) {
    return res.status(500).json({ error: 'Download failed' });
  }

  // Serve with range request support
  const stat = fs.statSync(tmpPath);
  const fileSize = stat.size;
  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : Math.min(start + 10 * 1024 * 1024 - 1, fileSize - 1);
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
    });
    fs.createReadStream(tmpPath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(tmpPath).pipe(res);
  }
}
