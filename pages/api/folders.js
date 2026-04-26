/**
 * GET /api/folders
 *
 * 回傳目前帳號的 Telegram 文件夾（Dialog Filters）清單。
 * 自動加上「所有聊天」（folderId=0）作為第一個選項。
 *
 * Response: { folders: [{ id, title, chatCount }] }
 */
import { getActiveAccount, getTelegramClient, releaseTelegramClient } from '../../lib/telegram';
import { Api } from 'telegram';

export default async function handler(req, res) {
  const { accountId } = req.query;
  const account = getActiveAccount(req, accountId);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const client = await getTelegramClient(account);

    // 取得文件夾清單
    const result = await client.invoke(new Api.messages.GetDialogFilters());

    const folders = [];

    for (const f of result.filters || result || []) {
      const cls = f.className || f._;
      if (cls === 'DialogFilterDefault' || cls === 'dialogFilterDefault') {
        // 系統預設「所有聊天」放在最前面
        folders.unshift({ id: 0, title: '所有聊天' });
      } else if (cls === 'DialogFilter' || cls === 'dialogFilter') {
        folders.push({ id: f.id, title: f.title || `文件夾 ${f.id}` });
      }
      // 略過 DialogFilterChatlist（Telegram Stars 功能）
    }

    // 若未出現 id=0 則手動補上
    if (!folders.find(f => f.id === 0)) {
      folders.unshift({ id: 0, title: '所有聊天' });
    }

    return res.json({ folders });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Failed to fetch folders' });
  } finally {
    releaseTelegramClient(account).catch(() => {});
  }
}
