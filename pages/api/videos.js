/**
 * GET /api/videos
 *   ?search=&accountId=&minDuration=10&maxDuration=180
 *   &chatIds=id1,id2,id3   ← only scan these groups (omit = scan all)
 *   &maxGroups=30           ← limit when scanning all groups
 *
 * Server-Sent Events stream:
 *   { type: 'total_chats', count }
 *   { type: 'scanning', chat }
 *   { type: 'video', video }
 *   { type: 'done', total }
 *   { type: 'error', message }
 *
 * Dedup rule: within the same group, if multiple messages share the same
 * filename, only the most recent one is emitted.
 */
import { getActiveAccount, getTelegramClient, bigIntReplacer } from '../../lib/telegram';
import { Api } from 'telegram';

export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  const {
    search = '',
    maxGroups = '30',
    accountId,
    minDuration = '10',
    maxDuration = '180',
    chatIds = '',           // comma-separated chatId strings, empty = scan all
  } = req.query;

  const minSec = parseInt(minDuration) || 0;
  const maxSec = parseInt(maxDuration) || Infinity;
  const selectedChatIds = chatIds ? chatIds.split(',').filter(Boolean) : [];

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

    // ── Resolve which dialogs to scan ─────────────────────────────────────────
    const dialogs = await client.getDialogs({ limit: 500 });
    const allGroupDialogs = dialogs.filter((d) => d.isGroup || d.isChannel);

    let groupDialogs;
    if (selectedChatIds.length > 0) {
      // Only scan the groups the user has selected
      groupDialogs = allGroupDialogs.filter((d) => {
        const id = d.entity?.id?.toString() || d.id?.toString();
        return selectedChatIds.includes(id);
      });
    } else {
      // No filter — scan up to maxGroups
      groupDialogs = allGroupDialogs.slice(0, parseInt(maxGroups));
    }

    send({ type: 'total_chats', count: groupDialogs.length });

    let totalVideos = 0;
    const searchLower = search.toLowerCase();

    for (const dialog of groupDialogs) {
      if (res.writableEnded) break;

      const chatTitle = dialog.title || '';
      send({ type: 'scanning', chat: chatTitle });

      try {
        const entity = dialog.entity;
        const chatId = entity?.id?.toString() || dialog.id?.toString();
        const isChannel = entity?.className === 'Channel' || entity?.megagroup === true;
        const chatType = isChannel ? 'channel' : 'chat';
        const accessHash = entity?.accessHash?.toString() || '0';

        // ── Collect all videos from this group, dedup by filename ─────────────
        // Key: fileName (or msgId if no filename) → keep latest by msg.date
        const dedupMap = new Map();

        for await (const msg of client.iterMessages(entity, {
          limit: 200,
          filter: new Api.InputMessagesFilterVideo(),
        })) {
          if (res.writableEnded) break;
          if (!msg?.media?.document) continue;

          const doc = msg.media.document;
          if (!doc?.mimeType?.startsWith('video/')) continue;

          let width = 0, height = 0, duration = 0, fileName = '';
          for (const attr of doc.attributes || []) {
            if (attr.className === 'DocumentAttributeVideo') {
              width = attr.w || 0;
              height = attr.h || 0;
              duration = attr.duration || 0;
            }
            if (attr.className === 'DocumentAttributeFilename') {
              fileName = attr.fileName || '';
            }
          }

          // Duration filter
          if (duration < minSec || duration > maxSec) continue;

          const title = msg.message?.trim() || fileName || chatTitle;

          // Search filter
          if (searchLower) {
            const haystack = `${title} ${chatTitle}`.toLowerCase();
            if (!haystack.includes(searchLower)) continue;
          }

          const hasThumbnail = Array.isArray(doc.thumbs) && doc.thumbs.length > 0;

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
            hasThumbnail,
            accountId: account.id,
          };

          // Dedup: use fileName as key (fallback to msgId if no filename)
          const dedupKey = fileName ? `fn:${fileName}` : `id:${msg.id}`;
          const existing = dedupMap.get(dedupKey);
          if (!existing || msg.date > existing.date) {
            dedupMap.set(dedupKey, video);
          }
        }

        // Emit deduplicated videos for this group (sorted newest first)
        const groupVideos = [...dedupMap.values()].sort((a, b) => b.date - a.date);
        for (const video of groupVideos) {
          if (res.writableEnded) break;
          send({ type: 'video', video });
          totalVideos++;
        }
      } catch {
        // Skip inaccessible chats silently
      }
    }

    send({ type: 'done', total: totalVideos });
  } catch (e) {
    send({ type: 'error', message: e.message });
  } finally {
    cleanup();
  }
}
