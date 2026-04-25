/**
 * GET /api/stream?chatId=&msgId=&accessHash=&chatType=&mimeType=&accountId=
 *
 * 從 Telegram 串流影片，支援 HTTP Range Request。
 *
 * 關鍵修正：
 *  1. 先收集 chunk buffer，再寫 headers ── 確保錯誤時能正確回 500
 *  2. 用 big-integer 的 bigInt()，不用原生 BigInt（GramJS iterDownload 規格要求）
 *  3. MTProto offset 必須對齊 PART_SIZE 邊界
 *  4. 每次 response 上限 2MB，讓瀏覽器以連續 Range request 串流
 */
import { getActiveAccount, getTelegramClient, buildInputPeer } from '../../lib/telegram';
import bigInt from 'big-integer';

export const config = { api: { responseLimit: false } };

const PART_SIZE = 512 * 1024;   // 512 KB — MTProto 下載單位
const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB — 每次 HTTP response 上限

export default async function handler(req, res) {
  const { chatId, msgId, accessHash, chatType, mimeType = 'video/mp4', accountId } = req.query;

  // ── 認證檢查 ────────────────────────────────────────────────────────────────
  const account = getActiveAccount(req, accountId);
  if (!account) {
    console.error('[stream] 401 – account not found, accountId:', accountId);
    return res.status(401).json({ error: 'Not authenticated', accountId });
  }

  try {
    const { Api } = require('telegram');
    const client = await getTelegramClient(account);
    const peer = buildInputPeer(chatId, accessHash, chatType);

    // ── 取得訊息 ──────────────────────────────────────────────────────────────
    const msgs = await client.getMessages(peer, { ids: [parseInt(msgId)] });
    const msg = msgs?.[0];
    if (!msg?.media?.document) return res.status(404).end('Video not found');

    const doc = msg.media.document;
    const fileSize = Number(doc.size || 0);
    const contentType = doc.mimeType || mimeType;

    // ── 解析 Range header ─────────────────────────────────────────────────────
    const rangeHeader = req.headers.range;
    let start = 0;
    let end = Math.min(CHUNK_SIZE - 1, fileSize - 1);

    if (rangeHeader) {
      const [s, e] = rangeHeader.replace(/bytes=/, '').split('-');
      start = parseInt(s, 10) || 0;
      end = e
        ? Math.min(parseInt(e, 10), start + CHUNK_SIZE - 1, fileSize - 1)
        : Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
    }

    const chunkLength = end - start + 1;

    // ── MTProto offset 對齊 ───────────────────────────────────────────────────
    const alignedOffset = Math.floor(start / PART_SIZE) * PART_SIZE;
    const skipBytes = start - alignedOffset;
    const downloadNeeded = skipBytes + chunkLength;

    // ── 先下載再寫 headers（避免 iterDownload 出錯時 headers 已送出）─────────
    const buffers = [];
    let totalBytes = 0;

    for await (const chunk of client.iterDownload({
      file: new Api.InputDocumentFileLocation({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: '',
      }),
      offset: bigInt(alignedOffset),   // big-integer，非原生 BigInt
      requestSize: PART_SIZE,
    })) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffers.push(buf);
      totalBytes += buf.length;
      if (totalBytes >= downloadNeeded) break;
    }

    // ── 寫 headers + 回傳資料 ─────────────────────────────────────────────────
    const fullBuffer = Buffer.concat(buffers);
    const responseBody = fullBuffer.slice(skipBytes, skipBytes + chunkLength);

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': responseBody.length,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    res.end(responseBody);

  } catch (e) {
    console.error('[stream] error:', e.message, e.stack?.split('\n')[1]);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
}
