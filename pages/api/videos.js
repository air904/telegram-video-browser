/**
 * GET /api/videos?search=&maxGroups=30&accountId=
 *
 * Server-Sent Events stream. Each event is a JSON object:
 *   { type: 'scanning', chat: '...' }
 *   { type: 'video', video: { ... } }
 *   { type: 'done', total: N }
 *   { type: 'error', message: '...' }
 */
import { getActiveAccount, getTelegramClient, bigIntReplacer } from '../../lib/telegram';
import { Api } from 'telegram';

export const config = { api: { responseLimit: false } };

export default async function handler(req, res) {
  const { search = '', maxGroups = '30', accountId } = req.query;
  const account = getActiveAccount(req, accountId);
  if (!account) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
  res.flushHeaders?.();

  const send = (obj) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(obj, bigIntReplacer)}\n\n`);
    }
  };

  // Keep-alive ping every 20s so the connection isn't closed
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
    const dialogs = await client.getDialogs({ limit: parseInt(maxGroups) + 20 });

    // Filter to groups and channels only
    const groupDialogs = dialogs
      .filter((d) => d.isGroup || d.isChannel)
      .slice(0, parseInt(maxGroups));

    send({ type: 'total_chats', count: groupDialogs.length });

    let totalVideos = 0;
    const searchLower = search.toLowerCase();

    for (const dialog of groupDialogs) {
      if (res.writableEnded) break;

      const chatTitle = dialog.title || '';
      send({ type: 'scanning', chat: chatTitle });

      try {
        // Determine entity metadata for later peer reconstruction
        const entity = dialog.entity;
        const chatId = entity?.id?.toString() || dialog.id?.toString();
        const isChannel =
          entity?.className === 'Channel' || entity?.megagroup === true;
        const chatType = isChannel ? 'channel' : 'chat';
        const accessHash = entity?.accessHash?.toString() || '0';

        for await (const msg of client.iterMessages(entity, {
          limit: 200,
          filter: new Api.InputMessagesFilterVideo(),
        })) {
          if (res.writableEnded) break;
          if (!msg?.media?.document) continue;

          const doc = msg.media.document;
          if (!doc?.mimeType?.startsWith('video/')) continue;

          // Extract video attributes
          let width = 0,
            height = 0,
            duration = 0,
            fileName = '';
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

          const title = msg.message?.trim() || fileName || chatTitle;

          // Apply search filter
          if (searchLower) {
            const haystack = `${title} ${chatTitle}`.toLowerCase();
            if (!haystack.includes(searchLower)) continue;
          }

          const hasThumbnail =
            Array.isArray(doc.thumbs) && doc.thumbs.length > 0;

          const video = {
            id: `${chatId}_${msg.id}`,
            msgId: msg.id,
            chatId,
            chatTitle,
            chatType,
            accessHash,
            title,
            date: msg.date,
            duration,
            width,
            height,
            fileSize: Number(doc.size || 0),
            mimeType: doc.mimeType || 'video/mp4',
            hasThumbnail,
            accountId: account.id,
          };

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
