/**
 * GET /api/folder-groups
 * 回傳指定文件夾內的群組 / 頻道清單。
 *
 * folderId=0  → 所有聊天（getDialogs 全部取回）
 * folderId=N  → 自訂文件夾：從 DialogFilter.include_peers 比對 dialogs
 *               Telegram 的 getDialogs(folder=N) 只支援 0=全部 / 1=封存；
 *               自訂 folder（N>1）必須手動對照 DialogFilter 規則。
 */
import { getActiveAccount, getTelegramClient, releaseTelegramClient } from '../../lib/telegram';
import { Api } from 'telegram';

// 從 InputPeer 物件取出 ID 字串
function peerIdStr(peer) {
  if (!peer) return null;
  const id = peer.channelId ?? peer.chatId ?? peer.userId ?? peer.peerId;
  if (id === undefined || id === null) return null;
  return typeof id === 'bigint' ? id.toString() : String(id);
}

// Dialog entity → 群組物件
function dialogToGroup(d) {
  const entity    = d.entity;
  const chatId    = entity?.id?.toString() || d.id?.toString();
  const isMega    = entity?.megagroup === true;
  const isChan    = entity?.className === 'Channel' && !isMega;
  const accessHash = entity?.accessHash?.toString() || '0';
  if (!chatId) return null;
  return {
    chatId,
    chatTitle:  d.title || chatId,
    chatType:   isChan ? 'channel' : 'chat',
    accessHash,
  };
}

export default async function handler(req, res) {
  const { accountId, folderId = '' } = req.query;
  const account = getActiveAccount(req, accountId);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const client      = await getTelegramClient(account);
    const folderIdNum = folderId !== '' ? parseInt(folderId) : null;

    // 一次取得所有 dialogs（上限 500）
    const dialogs      = await client.getDialogs({ limit: 500 });
    const groupDialogs = dialogs.filter(d => d.isGroup || d.isChannel);

    // ── 所有聊天（id=0）：直接返回全部群組 ───────────────────────────────
    if (folderIdNum === null || folderIdNum === 0) {
      const groups = groupDialogs.map(dialogToGroup).filter(Boolean);
      return res.json({ groups });
    }

    // ── 自訂文件夾：取得 DialogFilter 定義 ───────────────────────────────
    const result     = await client.invoke(new Api.messages.GetDialogFilters());
    const filterList = Array.isArray(result) ? result : (result?.filters ?? []);

    // 找到對應的 filter
    const filter = filterList.find(f => {
      const cls = (f.className || f._ || '').toLowerCase();
      if (!cls.includes('filter'))  return false;
      if (cls.includes('default'))  return false;
      if (cls.includes('chatlist')) return false;
      const id = typeof f.id === 'bigint' ? Number(f.id) : Number(f.id);
      return id === folderIdNum;
    });

    if (!filter) return res.json({ groups: [] });

    const includePeers = filter.includePeers  || filter.include_peers  || [];
    const excludePeers = filter.excludePeers  || filter.exclude_peers  || [];
    const includeIds   = new Set(includePeers.map(peerIdStr).filter(Boolean));
    const excludeIds   = new Set(excludePeers.map(peerIdStr).filter(Boolean));

    let filtered;

    if (includeIds.size > 0) {
      // 有明確列出的 include_peers（最常見的用法）→ 只取那些
      filtered = groupDialogs.filter(d => {
        const id = d.entity?.id?.toString();
        return id && includeIds.has(id) && !excludeIds.has(id);
      });
    } else {
      // 無 include_peers → 依 type flags 篩選
      filtered = groupDialogs.filter(d => {
        const id     = d.entity?.id?.toString();
        if (id && excludeIds.has(id)) return false;
        const isMega = d.entity?.megagroup === true;
        const isChan = d.entity?.className === 'Channel' && !isMega;
        if (filter.groups     && (d.isGroup || isMega)) return true;
        if (filter.broadcasts && isChan)                return true;
        return false;
      });
    }

    const groups = filtered.map(dialogToGroup).filter(Boolean);
    return res.json({ groups });

  } catch (e) {
    console.error('[folder-groups]', e);
    return res.status(500).json({ error: e.message || 'Failed' });
  } finally {
    releaseTelegramClient(account).catch(() => {});
  }
}
