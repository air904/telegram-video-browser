/**
 * GET /api/videos
 *
 * 兩種掃描模式：
 *
 * 模式 A（快速）— 前端傳入已知群組詳細資料，直接跳過 getDialogs
 *   ?groupsInfo=chatId1:hash1:type1:title1,...
 *
 * 模式 B（全掃）— 無 groupsInfo，掃描最近的 maxGroups 個群組
 *   ?maxGroups=30&search=&minDuration=10&maxDuration=180
 *
 * 共用參數：
 *   videosPerGroup=50   每個群組最多回傳幾支（dedup 後）
 *   days=7              只顯示最近幾天的影片（0 = 不限）
 *
 * SSE events:
 *   { type: 'total_chats', count }
 *   { type: 'scanning', chat }
 *   { type: 'video', video }
 *   { type: 'done', total }
 *   { type: 'error', message }
 *
 * Dedup: 同群組相同檔名只保留最新一筆。
 */
import { getActiveAccount, getTelegramClient, releaseTelegramClient, buildInputPeer, bigIntReplacer } from '../../lib/telegram';
import { Api } from 'telegram';

export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  const {
    search = '',
    maxGroups = '30',
    accountId,
    minDuration = '0',
    maxDuration = '99999',
    videosPerGroup = '200', // 每個群組最多回傳幾支（dedup 後）
    days = '0',             // 只顯示最近 N 天；0 = 不限
    groupsInfo = '',        // 模式 A：chatId:hash:type:encodedTitle,...
    chatIds = '',           // 舊版相容
    folderId = '',          // 模式 B 文件夾：Telegram folder ID（空字串 = 不限）
  } = req.query;

  const minSec = parseInt(minDuration) || 0;
  const maxSec = parseInt(maxDuration) || Infinity;
  const vPerGroup = Math.max(1, parseInt(videosPerGroup) || 50);
  const daysBack = parseInt(days) || 0;
  // Unix timestamp cutoff（0 = 無限制）
  const cutoffTs = daysBack > 0 ? Math.floor(Date.now() / 1000) - daysBack * 86400 : 0;

  const account = getActiveAccount(req, accountId);
  if (!account) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  // ── SSE setup ──────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (obj) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(obj, bigIntReplacer)}\n\n`);
    }
  };

  const pingInterval = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 20_000);

  const cleanup = () => {
    clearInterval(pingInterval);
    if (!res.writableEnded) res.end();
  };

  req.on('close', cleanup);

  try {
    const client = await getTelegramClient(account);

    // ── 決定要掃哪些群組 ────────────────────────────────────────────────────────

    // 模式 A：前端傳入完整群組資料 → 直接用 InputPeer，不需要 getDialogs
    if (groupsInfo) {
      const groups = groupsInfo.split(',').map((g) => {
        const parts = g.split(':');
        return {
          chatId: parts[0],
          accessHash: parts[1] || '0',
          chatType: parts[2] || 'channel',
          chatTitle: parts[3] ? decodeURIComponent(parts[3]) : parts[0],
        };
      }).filter((g) => g.chatId);

      send({ type: 'total_chats', count: groups.length });
      let totalVideos = 0;
      const searchLower = search.toLowerCase();

      for (const group of groups) {
        if (res.writableEnded) break;
        send({ type: 'scanning', chat: group.chatTitle });
        totalVideos += await scanGroup(client, group, minSec, maxSec, searchLower, send, account, vPerGroup, cutoffTs);
      }

      send({ type: 'done', total: totalVideos });
      return;
    }

    // 模式 B：透過 getDialogs 掃群組
    // 若有 folderId → 只掃該文件夾內的對話；否則掃最近 N 個
    const selectedChatIds = chatIds ? chatIds.split(',').filter(Boolean) : [];
    const folderIdNum = folderId !== '' ? parseInt(folderId) : null;

    const dialogOpts = folderIdNum !== null
      ? { limit: 500, folder: folderIdNum }          // 依文件夾取得
      : { limit: parseInt(maxGroups) + 20 };          // 依最近對話數取得

    const dialogs = await client.getDialogs(dialogOpts);
    let groupDialogs = dialogs.filter((d) => d.isGroup || d.isChannel);

    if (selectedChatIds.length > 0) {
      groupDialogs = groupDialogs.filter((d) => {
        const id = d.entity?.id?.toString() || d.id?.toString();
        return selectedChatIds.includes(id);
      });
    } else if (folderIdNum === null) {
      // 非文件夾模式才限制數量
      groupDialogs = groupDialogs.slice(0, parseInt(maxGroups));
    }

    send({ type: 'total_chats', count: groupDialogs.length });

    let totalVideos = 0;
    const searchLower = search.toLowerCase();

    for (const dialog of groupDialogs) {
      if (res.writableEnded) break;
      const chatTitle = dialog.title || '';
      send({ type: 'scanning', chat: chatTitle });

      const entity = dialog.entity;
      const chatId = entity?.id?.toString() || dialog.id?.toString();
      const isChannel = entity?.className === 'Channel' || entity?.megagroup === true;
      const chatType = isChannel ? 'channel' : 'chat';
      const accessHash = entity?.accessHash?.toString() || '0';

      totalVideos += await scanGroup(
        client,
        { chatId, accessHash, chatType, chatTitle },
        minSec, maxSec, searchLower, send, account, vPerGroup, cutoffTs
      );
    }

    send({ type: 'done', total: totalVideos });

  } catch (e) {
    send({ type: 'error', message: e.message });
  } finally {
    cleanup();
    releaseTelegramClient(account).catch(() => {});
  }
}

// ── 掃描單一群組，回傳影片數；含 dedup 邏輯 ──────────────────────────────────

async function scanGroup(
  client,
  { chatId, accessHash, chatType, chatTitle },
  minSec, maxSec, searchLower, send, account,
  vPerGroup = 50,   // 每群組最多輸出幾支（dedup 後）
  cutoffTs = 0      // Unix 時間截止（0 = 不限）
) {
  try {
    const peer = buildInputPeer(chatId, accessHash, chatType);
    const dedupMap = new Map(); // dedupKey → latest video

    // 最多抓 vPerGroup * 8 則訊息（保留足夠裕量給 dedup 和時長篩選）
    const fetchLimit = Math.min(vPerGroup * 8, 800);

    for await (const msg of client.iterMessages(peer, {
      limit: fetchLimit,
      filter: new Api.InputMessagesFilterVideo(),
    })) {
      // 訊息是從新到舊排列，一旦超出天數截止就可以 break
      if (cutoffTs > 0 && msg.date < cutoffTs) break;

      if (!msg?.media?.document) continue;
      const doc = msg.media.document;
      if (!doc?.mimeType?.startsWith('video/')) continue;

      let width = 0, height = 0, duration = 0, fileName = '';
      for (const attr of doc.attributes || []) {
        if (attr.className === 'DocumentAttributeVideo') {
          width = attr.w || 0; height = attr.h || 0; duration = attr.duration || 0;
        }
        if (attr.className === 'DocumentAttributeFilename') {
          fileName = attr.fileName || '';
        }
      }

      if (duration < minSec || duration > maxSec) continue;

      const title = msg.message?.trim() || fileName || chatTitle;
      if (searchLower) {
        if (!`${title} ${chatTitle}`.toLowerCase().includes(searchLower)) continue;
      }

      const video = {
        id: `${chatId}_${msg.id}`,
        msgId: msg.id,
        chatId,
        chatTitle,
        chatType,
        accessHash,
        title,
        fileName,
        date: msg.date,
        duration,
        width,
        height,
        fileSize: Number(doc.size || 0),
        mimeType: doc.mimeType || 'video/mp4',
        hasThumbnail: Array.isArray(doc.thumbs) && doc.thumbs.length > 0,
        accountId: account.id,
      };

      const dedupKey = fileName ? `fn:${fileName}` : `id:${msg.id}`;
      const existing = dedupMap.get(dedupKey);
      if (!existing || msg.date > existing.date) {
        dedupMap.set(dedupKey, video);
      }
    }

    // 最新的 vPerGroup 支
    const sorted = [...dedupMap.values()]
      .sort((a, b) => b.date - a.date)
      .slice(0, vPerGroup);

    for (const video of sorted) send({ type: 'video', video });
    return sorted.length;

  } catch {
    return 0; // 略過無法存取的群組
  }
}
