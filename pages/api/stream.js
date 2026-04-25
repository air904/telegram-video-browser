/**
 * GET /api/stream?chatId=&msgId=&accessHash=&chatType=&mimeType=&accountId=
 *
 * 直接從 Telegram 串流影片到瀏覽器，不需要預先下載。
 * 支援 HTTP Range Request（讓 <video> 可拖拉進度條）。
 *
 * - 無 Range header → 串流完整影片（PassThrough pipe）
 * - 有 Range header → 用 downloadMedia(start, end) 取得指定片段
 */
import { getActiveAccount, getTelegramClient, buildInputPeer } from '../../lib/telegram';
import { PassThrough } from 'stream';

export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  const { chatId, msgId, accessHash, chatType, mimeType = 'video/mp4', accountId } = req.query;
  const account = getActiveAccount(req, accountId);
  if (!account) return res.status(401).end('Not authenticated');

  try {
    const client = await getTelegramClient(account);
    const peer = buildInputPeer(chatId, accessHash, chatType);

    // Get message metadata (needed for fileSize and Content-Type)
    const msgs = await client.getMessages(peer, { ids: [parseInt(msgId)] });
    const msg = msgs?.[0];
    if (!msg?.media?.document) return res.status(404).end('Not found');

    const doc = msg.media.document;
    const fileSize = Number(doc.size || 0);
    const contentType = doc.mimeType || mimeType;

    // Disable cache to allow range requests from the browser
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');

    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      // ── Range request (seeking / chunked load) ──────────────────────────────
      const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10) || 0;
      // Default chunk: 5 MB or to end of file
      const end = endStr ? parseInt(endStr, 10) : Math.min(start + 5 * 1024 * 1024 - 1, fileSize - 1);

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': end - start + 1,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });

      // Download only the requested byte range from Telegram
      const chunk = await client.downloadMedia(msg, {
        start,
        end: end + 1,   // GramJS end is exclusive
        workers: 1,
      });

      res.end(chunk || Buffer.alloc(0));
    } else {
      // ── Full stream (initial play, no seek) ──────────────────────────────────
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });

      // Pipe download directly to response — no disk I/O
      const pass = new PassThrough();
      pass.pipe(res);

      req.on('close', () => {
        if (!pass.destroyed) pass.destroy();
      });

      try {
        await client.downloadMedia(msg, {
          outputFile: pass,
          workers: 4,
          progressCallback: () => {}, // suppress console noise
        });
      } finally {
        if (!pass.destroyed) pass.end();
      }
    }
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
}
