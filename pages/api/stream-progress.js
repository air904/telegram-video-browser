/**
 * GET /api/stream-progress?chatId=&msgId=&accountId=
 *
 * SSE endpoint: emits download progress updates for the stream.js download.
 */
import { getActiveAccount } from '../../lib/telegram';
import { downloadProgress } from './stream';

export const config = { api: { responseLimit: false } };

export default function handler(req, res) {
  const { chatId, msgId, accountId } = req.query;
  const account = getActiveAccount(req, accountId);
  if (!account) return res.status(401).end();

  const cacheKey = `${account.id}_${chatId}_${msgId}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const interval = setInterval(() => {
    const prog = downloadProgress.get(cacheKey) || { pct: 0, done: false, error: null };
    send(prog);
    if (prog.done || prog.error) {
      clearInterval(interval);
      if (!res.writableEnded) res.end();
    }
  }, 500);

  req.on('close', () => {
    clearInterval(interval);
    if (!res.writableEnded) res.end();
  });
}
