/**
 * GET /api/folders
 *
 * 回傳目前帳號的 Telegram 文件夾（Dialog Filters）清單。
 * 自動加上「所有聊天」（folderId=0）作為第一個選項。
 *
 * Response: { folders: [{ id, title }] }
 *
 * 注意：新版 Telegram API（layer 147+）中 DialogFilter.title 可能是
 * TextWithEntities 物件而非字串，safeTitle() 統一轉換為字串。
 */
import { getActiveAccount, getTelegramClient, releaseTelegramClient } from '../../lib/telegram';
import { Api } from 'telegram';

// 將 title 安全地轉換為字串（防止 TextWithEntities 物件直接傳到前端）
function safeTitle(raw, fallback) {
  if (!raw && raw !== 0) return fallback;
  if (typeof raw === 'string') return raw;
  // GramJS TextWithEntities: { text: '...', entities: [] }
  if (typeof raw === 'object' && typeof raw.text === 'string') return raw.text;
  // 其他物件：嘗試轉字串
  try { const s = String(raw); return s === '[object Object]' ? fallback : s; } catch { return fallback; }
}

export default async function handler(req, res) {
  const { accountId } = req.query;
  const account = getActiveAccount(req, accountId);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const client = await getTelegramClient(account);

    // 取得文件夾清單
    const result = await client.invoke(new Api.messages.GetDialogFilters());

    const folders = [];
    // result 可能是 { filters: [...] } 或直接是陣列
    const filterList = Array.isArray(result) ? result : (result?.filters ?? []);

    for (const f of filterList) {
      const cls = (f.className || f._ || '').toLowerCase();
      if (cls.includes('default')) {
        folders.unshift({ id: 0, title: '所有聊天' });
      } else if (cls.includes('filter') && !cls.includes('chatlist')) {
        const id    = typeof f.id === 'bigint' ? Number(f.id) : (Number(f.id) || 0);
        const title = safeTitle(f.title, `文件夾 ${id}`);
        folders.push({ id, title });
      }
    }

    // 若未出現 id=0 則手動補上
    if (!folders.find(f => f.id === 0)) {
      folders.unshift({ id: 0, title: '所有聊天' });
    }

    return res.json({ folders });
  } catch (e) {
    console.error('[folders API]', e);
    return res.status(500).json({ error: e.message || 'Failed to fetch folders' });
  } finally {
    releaseTelegramClient(account).catch(() => {});
  }
}
