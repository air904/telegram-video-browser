/**
 * GET /api/folder-groups
 * 回傳指定文件夾內的群組 / 頻道清單。
 * ?folderId=N  (0 = 所有聊天, N = 特定文件夾)
 */
import { getActiveAccount, getTelegramClient, releaseTelegramClient } from '../../lib/telegram';

export default async function handler(req, res) {
  const { accountId, folderId = '' } = req.query;
  const account = getActiveAccount(req, accountId);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const client = await getTelegramClient(account);
    const folderIdNum = folderId !== '' ? parseInt(folderId) : null;

    const dialogOpts = folderIdNum !== null
      ? { limit: 500, folder: folderIdNum }
      : { limit: 500 };

    const dialogs = await client.getDialogs(dialogOpts);

    const groups = dialogs
      .filter(d => d.isGroup || d.isChannel)
      .map(d => {
        const entity = d.entity;
        const chatId = entity?.id?.toString() || d.id?.toString();
        const isChannel = entity?.className === 'Channel' || entity?.megagroup === true;
        const accessHash = entity?.accessHash?.toString() || '0';
        return {
          chatId,
          chatTitle: d.title || chatId,
          chatType: isChannel ? 'channel' : 'chat',
          accessHash,
        };
      });

    return res.json({ groups });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to fetch groups' });
  } finally {
    releaseTelegramClient(account).catch(() => {});
  }
}
