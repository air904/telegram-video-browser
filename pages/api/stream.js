/**
 * GET /api/stream?chatId=&msgId=&accessHash=&chatType=&mimeType=&accountId=
 *
 * 直接從 Telegram 串流影片到瀏覽器，支援 HTTP Range Request。
 *
 * 修正重點：
 *  - 改用 client.iterDownload() 取代 downloadMedia({ start, end })
 *    （downloadMedia 不支援 byte-range，iterDownload 才是正確 API）
 *  - 強制對齊 MTProto 4096-byte 邊界（offset 必須是 PART_SIZE 的倍數）
 *  - 無論有無 Range header 一律回 206，每次最多回傳 CHUNK_SIZE bytes
 *    讓瀏覽器以連續 Range request 串流，避免單次請求過大卡住
 */
import { getActiveAccount, getTelegramClient, buildInputPeer } from '../../lib/telegram';

export const config = { api: { responseLimit: false } };

// MTProto 規定每次請求必須是此大小的倍數，最大 512 KB
const PART_SIZE = 512 * 1024;  // 512 KB
// 每個 HTTP response 最多回傳的 bytes（控制回應速度 / 避免 OOM）
const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB

export default async function handler(req, res) {
  const { chatId, msgId, accessHash, chatType, mimeType = 'video/mp4', accountId } = req.query;
  const account = getActiveAccount(req, accountId);
  if (!account) return res.status(401).end('Not authenticated');

  try {
    const { Api } = require('telegram');
    const client = await getTelegramClient(account);
    const peer = buildInputPeer(chatId, accessHash, chatType);

    // 取得訊息 metadata
    const msgs = await client.getMessages(peer, { ids: [parseInt(msgId)] });
    const msg = msgs?.[0];
    if (!msg?.media?.document) return res.status(404).end('Not found');

    const doc = msg.media.document;
    const fileSize = Number(doc.size || 0);
    const contentType = doc.mimeType || mimeType;

    // 建立 Telegram 檔案 location（用於 iterDownload）
    const inputLocation = new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize: '',
    });

    // 解析 Range header（瀏覽器常送 bytes=0-1 作為探測）
    const rangeHeader = req.headers.range;
    let start = 0;
    let end = Math.min(CHUNK_SIZE - 1, fileSize - 1);

    if (rangeHeader) {
      const [s, e] = rangeHeader.replace(/bytes=/, '').split('-');
      start = parseInt(s, 10) || 0;
      // 若瀏覽器指定 end，取其值；否則預設 start + CHUNK_SIZE
      end = e
        ? Math.min(parseInt(e, 10), start + CHUNK_SIZE - 1, fileSize - 1)
        : Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
    }

    const chunkLength = end - start + 1;

    // 對齊到 PART_SIZE 邊界（MTProto 要求）
    const alignedOffset = Math.floor(start / PART_SIZE) * PART_SIZE;
    const skipBytes = start - alignedOffset;   // 對齊後多取的前置 bytes
    const downloadNeeded = skipBytes + chunkLength;

    // 回傳 206 Partial Content（包含 Range 資訊讓瀏覽器繼續請求後續片段）
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkLength,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });

    // 用 iterDownload 從對齊位置開始下載，累積到足夠量就停止
    const buffers = [];
    let totalBytes = 0;

    for await (const chunk of client.iterDownload({
      file: inputLocation,
      offset: BigInt(alignedOffset),
      requestSize: PART_SIZE,
    })) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffers.push(buf);
      totalBytes += buf.length;
      if (totalBytes >= downloadNeeded) break;
    }

    // 拼接後裁切出瀏覽器真正需要的 byte 範圍
    const fullBuffer = Buffer.concat(buffers);
    res.end(fullBuffer.slice(skipBytes, skipBytes + chunkLength));

  } catch (e) {
    console.error('[stream]', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
}
