/**
 * GET /api/groups?accountId=
 *
 * 快速蒐集帳號下所有群組與頻道名稱，不掃描影片訊息。
 * 回傳：{ groups: [{ chatId, chatTitle, chatType, accessHash, count }] }
 */
import { getActiveAccount, getTelegramClient } from '../../lib/telegram';

export default async function handler(req, res) {
  const { accountId } = req.query;
  const account = getActiveAccount(req, accountId);
  if (!account) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const client = await getTelegramClient(account);

    // 取得所有對話（最多 500 個）
    const dialogs = await client.getDialogs({ limit: 500 });

    const groups = [];
    for (const dialog of dialogs) {
      // 只保留群組和頻道
      if (!dialog.isGroup && !dialog.isChannel) continue;

      const entity = dialog.entity;
      if (!entity) continue;

      const isChannel = entity.className === 'Channel';
      const chatId = entity.id?.toString() || dialog.id?.toString();
      if (!chatId) continue;

      groups.push({
        chatId,
        chatTitle: dialog.title || entity.title || 'Unknown',
        chatType: isChannel ? 'channel' : 'chat',
        accessHash: entity.accessHash?.toString() || '0',
        count: 0,
      });
    }

    return res.json({ groups });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
