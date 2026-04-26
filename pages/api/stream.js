/**
 * GET /api/stream?chatId=&msgId=&accessHash=&chatType=&mimeType=&accountId=
 *
 * 從 Telegram 串流影片，支援 HTTP Range Request。
 *
 * v2 改善（方案 C）：
 *  1. PART_SIZE 512KB → 1MB（MTProto 上限），每次 DC 往返下載量翻倍
 *  2. CHUNK_SIZE 2MB → 8MB，瀏覽器 round-trip 次數減少 75%
 *  3. 真正串流：收到每個 MTProto chunk 立刻 pipe 給瀏覽器，
 *     不再等全部 buffer 收集完才送出 → time-to-first-byte 大幅改善
 *  4. getMessages 取到 doc 資訊後立即寫 headers，接著邊下邊傳
 *  5. 中途斷線（瀏覽器關閉）自動終止 iterDownload
 */
import { getActiveAccount, getTelegramClient, buildInputPeer } from '../../lib/telegram';
import bigInt from 'big-integer';

export const config = { api: { responseLimit: false } };

const PART_SIZE  = 1024 * 1024;      // 1 MB — MTProto 單次下載上限
const CHUNK_SIZE = 8 * 1024 * 1024;  // 8 MB — 每次 HTTP response 上限

export default async function handler(req, res) {
  const {
    chatId, msgId, accessHash, chatType, mimeType = 'video/mp4', accountId,
    fileSize: fileSizeParam,
    docId, docAccessHash, docFileRef,
  } = req.query;

  // ── 認證檢查 ────────────────────────────────────────────────────────────────
  const account = getActiveAccount(req, accountId);
  if (!account) {
    console.error('[stream] 401 – account not found, accountId:', accountId);
    return res.status(401).json({ error: 'Not authenticated', accountId });
  }

  try {
    const { Api } = require('telegram');
    const client = await getTelegramClient(account);

    // ── Doc metadata 取得（兩條路徑）────────────────────────────────────────
    // 快速路徑：掃描時已取得 doc 資訊，直接組 InputDocumentFileLocation
    //   → 省去一次 getMessages() Telegram round-trip（節省 500-2000ms）
    // 慢速路徑：沒有 doc 資訊（舊版收藏/直接連結）→ 呼叫 getMessages fallback
    let doc, fileSize, contentType;

    if (docId && docAccessHash && docFileRef) {
      // ── 快速路徑 ──────────────────────────────────────────────────────────
      try {
        doc = {
          id:            bigInt(docId),
          accessHash:    bigInt(docAccessHash),
          fileReference: Buffer.from(decodeURIComponent(docFileRef), 'base64'),
        };
        fileSize    = parseInt(fileSizeParam) || 0;
        contentType = mimeType;
      } catch (parseErr) {
        console.warn('[stream] fast-path parse failed, falling back:', parseErr.message);
        doc = null;
      }
    }

    if (!doc) {
      // ── 慢速路徑（fallback）────────────────────────────────────────────────
      const peer = buildInputPeer(chatId, accessHash, chatType);
      const msgs = await client.getMessages(peer, { ids: [parseInt(msgId)] });
      const msg  = msgs?.[0];
      if (!msg?.media?.document) return res.status(404).end('Video not found');
      doc         = msg.media.document;
      fileSize    = Number(doc.size || 0);
      contentType = doc.mimeType || mimeType;
    }

    // ── 解析 Range header ─────────────────────────────────────────────────────
    const rangeHeader = req.headers.range;
    let start = 0;
    let end   = Math.min(CHUNK_SIZE - 1, fileSize - 1);

    if (rangeHeader) {
      const [s, e] = rangeHeader.replace(/bytes=/, '').split('-');
      start = parseInt(s, 10) || 0;
      end   = e
        ? Math.min(parseInt(e, 10), start + CHUNK_SIZE - 1, fileSize - 1)
        : Math.min(start + CHUNK_SIZE - 1, fileSize - 1);
    }

    const chunkLength = end - start + 1;

    // ── MTProto offset 對齊（必須對齊 PART_SIZE 邊界）────────────────────────
    const alignedOffset = Math.floor(start / PART_SIZE) * PART_SIZE;
    const skipBytes     = start - alignedOffset;  // 起始對齊補位需跳過的 bytes

    // ── 立即寫 headers，接著邊下邊傳 ─────────────────────────────────────────
    res.writeHead(206, {
      'Content-Range':  `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkLength,
      'Content-Type':   contentType,
      'Accept-Ranges':  'bytes',
      'Cache-Control':  'no-store',
    });

    // ── 串流下載：每收到一個 MTProto chunk 立刻 write 給瀏覽器 ───────────────
    let toSkip  = skipBytes;   // 剩餘需跳過的對齊補位 bytes
    let written = 0;            // 已寫出的 bytes 數

    for await (const chunk of client.iterDownload({
      file: new Api.InputDocumentFileLocation({
        id:            doc.id,
        accessHash:    doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize:     '',
      }),
      offset:      bigInt(alignedOffset),
      requestSize: PART_SIZE,
    })) {
      // 如果瀏覽器已關閉連線（例如滑到下一支），立刻停止下載
      if (res.writableEnded || res.destroyed) break;

      let data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      // 跳過 MTProto 對齊補位（只在第一個 chunk 可能發生）
      if (toSkip > 0) {
        if (data.length <= toSkip) {
          toSkip -= data.length;
          continue;
        }
        data   = data.slice(toSkip);
        toSkip = 0;
      }

      // 不超過 chunkLength
      const remaining = chunkLength - written;
      if (remaining <= 0) break;

      const writeLen = Math.min(data.length, remaining);
      res.write(data.slice(0, writeLen));
      written += writeLen;

      if (written >= chunkLength) break;
    }

    if (!res.writableEnded) res.end();

  } catch (e) {
    console.error('[stream] error:', e.message, e.stack?.split('\n')[1]);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    } else if (!res.writableEnded) {
      // headers 已送出，只能強制關閉連線（瀏覽器會顯示 media error 並可重試）
      res.destroy();
    }
  }
}
