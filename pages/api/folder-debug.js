/**
 * GET /api/folder-debug?folderId=N
 * 診斷用 — 顯示指定文件夾的原始 DialogFilter 資料
 * 和 getDialogs 回傳的群組列表，用於排查 folder-groups 無法正確回傳群組的問題。
 */
import { getActiveAccount, getTelegramClient, releaseTelegramClient } from '../../lib/telegram';
import { Api } from 'telegram';

function safeSerialize(obj, depth = 0) {
  if (depth > 3) return '[deep]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return `BigInt(${obj.toString()})`;
  if (typeof obj === 'string' || typeof obj === 'number' || typeof obj === 'boolean') return obj;
  if (Array.isArray(obj)) return obj.slice(0, 20).map(x => safeSerialize(x, depth + 1));
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj).slice(0, 30)) {
      try { out[k] = safeSerialize(obj[k], depth + 1); } catch { out[k] = '[error]'; }
    }
    return out;
  }
  return String(obj);
}

export default async function handler(req, res) {
  const { accountId, folderId = '' } = req.query;
  const account = getActiveAccount(req, accountId);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const client      = await getTelegramClient(account);
    const folderIdNum = folderId !== '' ? parseInt(folderId) : null;

    // 1. 取回所有 dialogs
    const dialogs      = await client.getDialogs({ limit: 500 });
    const groupDialogs = dialogs.filter(d => d.isGroup || d.isChannel);

    // 2. 取回 DialogFilters
    const result     = await client.invoke(new Api.messages.GetDialogFilters());
    const filterList = Array.isArray(result) ? result : (result?.filters ?? []);

    // 3. 找到目標 filter
    const filter = filterList.find(f => {
      const cls = (f.className || f._ || '').toLowerCase();
      if (!cls.includes('filter'))  return false;
      if (cls.includes('default'))  return false;
      if (cls.includes('chatlist')) return false;
      return Number(f.id) === folderIdNum;
    });

    // 4. 建立診斷資料
    const filterSummary = filterList.map(f => ({
      id:        safeSerialize(f.id),
      className: f.className || f._ || '?',
      title:     safeSerialize(f.title),
      groups:    f.groups,
      broadcasts: f.broadcasts,
      includePeersCount: (f.includePeers || f.include_peers || []).length,
      excludePeersCount: (f.excludePeers || f.exclude_peers || []).length,
    }));

    // 5. 針對目標 filter，顯示 include_peers 的原始資料
    let targetFilterDetail = null;
    if (filter) {
      const includePeers = filter.includePeers || filter.include_peers || [];
      const excludePeers = filter.excludePeers || filter.exclude_peers || [];
      targetFilterDetail = {
        id:         safeSerialize(filter.id),
        className:  filter.className || filter._ || '?',
        title:      safeSerialize(filter.title),
        groups:     filter.groups,
        broadcasts: filter.broadcasts,
        contacts:   filter.contacts,
        nonContacts: filter.nonContacts,
        includePeers: includePeers.slice(0, 10).map(p => safeSerialize(p)),
        excludePeers: excludePeers.slice(0, 10).map(p => safeSerialize(p)),
      };
    }

    // 6. 顯示 groupDialogs 的 entity.id 樣本
    const dialogSample = groupDialogs.slice(0, 20).map(d => {
      const e = d.entity;
      if (!e) return { title: d.title, entityNull: true };
      return {
        title:     d.title,
        className: e.className,
        id:        safeSerialize(e.id),
        megagroup: e.megagroup,
        isGroup:   d.isGroup,
        isChannel: d.isChannel,
      };
    });

    return res.json({
      totalDialogs:       dialogs.length,
      groupDialogsCount:  groupDialogs.length,
      requestedFolderId:  folderIdNum,
      filterFound:        !!filter,
      allFilters:         filterSummary,
      targetFilterDetail,
      dialogSample,
    });

  } catch (e) {
    console.error('[folder-debug]', e);
    return res.status(500).json({ error: e.message || 'Failed' });
  } finally {
    releaseTelegramClient(account).catch(() => {});
  }
}
