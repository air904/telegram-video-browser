/**
 * GET /api/folder-groups
 * 回傳指定文件夾內的群組 / 頻道清單。
 *
 * folderId=0  → 所有聊天（全部 dialogs）
 * folderId=N  → 自訂文件夾：
 *   一個 dialog 屬於該文件夾，若：
 *   (A) 在 include_peers 明確列出，OR
 *   (B) 符合 type flags（groups / broadcasts）
 *   AND NOT 在 exclude_peers
 *
 * 注意：Telegram getDialogs(folder=N) 只支援 0=全部 / 1=封存；
 * 自訂文件夾（N≥2）必須手動比對 DialogFilter 規則。
 */
import { getActiveAccount, getTelegramClient, releaseTelegramClient } from '../../lib/telegram';
import { Api } from 'telegram';

/** BigInt / Number → 絕對值字串 */
function toAbsStr(raw) {
  if (raw === undefined || raw === null) return null;
  try {
    const n = typeof raw === 'bigint' ? raw : BigInt(String(raw).replace(/^-/, ''));
    return n < 0n ? (-n).toString() : n.toString();
  } catch { return null; }
}

/** 從各種 InputPeer 格式取出 ID 字串（支援多種 GramJS 版本） */
function peerIdStr(peer) {
  if (!peer) return null;

  // 直接欄位：camelCase + snake_case
  const direct = peer.channelId ?? peer.chatId ?? peer.userId
    ?? peer.channel_id ?? peer.chat_id ?? peer.user_id;
  if (direct !== undefined && direct !== null) return toAbsStr(direct);

  // 巢狀 peerId（部分 GramJS 版本把真正 ID 包在 peer.peerId.channelId 之類）
  const inner = peer.peerId || peer.peer_id;
  if (inner && typeof inner === 'object') {
    const id2 = inner.channelId ?? inner.chatId ?? inner.userId
      ?? inner.channel_id ?? inner.chat_id ?? inner.user_id;
    if (id2 !== undefined && id2 !== null) return toAbsStr(id2);
  }
  // 若 peer 本身就是 PeerChannel/PeerChat
  if (peer.className) {
    if (peer.className === 'PeerChannel') return toAbsStr(peer.channelId);
    if (peer.className === 'PeerChat')    return toAbsStr(peer.chatId);
    if (peer.className === 'PeerUser')    return toAbsStr(peer.userId);
  }
  return null;
}

/** Dialog → 群組資料物件 */
function dialogToGroup(d) {
  const entity = d.entity;
  if (!entity) return null;
  const rawId = entity.id;
  if (rawId === undefined || rawId === null) return null;
  const chatId = typeof rawId === 'bigint'
    ? (rawId < 0n ? (-rawId).toString() : rawId.toString())
    : String(Math.abs(Number(rawId)));
  const isMega = entity.megagroup === true;
  const isChan = entity.className === 'Channel' && !isMega;
  const accessHash = entity.accessHash?.toString() || '0';
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

    // 一次取回所有 dialogs（含所有文件夾）
    const dialogs      = await client.getDialogs({ limit: 500 });
    const groupDialogs = dialogs.filter(d => d.isGroup || d.isChannel);

    // ── 所有聊天（id=0）：直接回傳全部群組 ──────────────────────────────────
    if (folderIdNum === null || folderIdNum === 0) {
      return res.json({ groups: groupDialogs.map(dialogToGroup).filter(Boolean) });
    }

    // ── 自訂文件夾：找到對應的 DialogFilter ─────────────────────────────────
    const result     = await client.invoke(new Api.messages.GetDialogFilters());
    const filterList = Array.isArray(result) ? result : (result?.filters ?? []);

    const filter = filterList.find(f => {
      const cls = (f.className || f._ || '').toLowerCase();
      if (!cls.includes('filter'))  return false;
      if (cls.includes('default'))  return false;
      if (cls.includes('chatlist')) return false;
      return Number(f.id) === folderIdNum;
    });

    if (!filter) {
      console.log(`[folder-groups] folderId=${folderIdNum} — no matching filter found. Available:`,
        filterList.map(f => `${f.className||f._}#${f.id}`).join(', '));
      return res.json({ groups: [] });
    }

    // include_peers / exclude_peers（支援 camelCase 與 snake_case）
    const includePeers = filter.includePeers  || filter.include_peers  || [];
    const excludePeers = filter.excludePeers  || filter.exclude_peers  || [];
    const includeIds   = new Set(includePeers.map(peerIdStr).filter(Boolean));
    const excludeIds   = new Set(excludePeers.map(peerIdStr).filter(Boolean));

    console.log(`[folder-groups] folderId=${folderIdNum} filter="${
      typeof filter.title === 'string' ? filter.title : filter.title?.text || '?'
    }" groups=${filter.groups} broadcasts=${filter.broadcasts} includePeers=${includePeers.length} → ids=[${[...includeIds].slice(0,5).join(',')}] excludePeers=${excludePeers.length} groupDialogs=${groupDialogs.length}`);

    // ── 正確篩選邏輯（A OR B，NOT excluded）──────────────────────────────────
    // 不能用 if/else；必須同時考慮 include_peers 和 type flags
    const filtered = groupDialogs.filter(d => {
      const entity = d.entity;
      if (!entity) return false;

      // 取得用於比對的 ID（取絕對值）
      const rawId = entity.id;
      const cmpId = rawId !== undefined && rawId !== null
        ? (typeof rawId === 'bigint'
            ? (rawId < 0n ? (-rawId).toString() : rawId.toString())
            : String(Math.abs(Number(rawId))))
        : null;

      // 若在 exclude_peers → 一律排除
      if (cmpId && excludeIds.has(cmpId)) return false;

      // (A) 在 include_peers → 包含
      if (cmpId && includeIds.has(cmpId)) return true;

      // (B) 符合 type flags → 包含
      const isMega = entity.megagroup === true;
      const isChan = entity.className === 'Channel' && !isMega;
      if (filter.groups     && (d.isGroup || isMega)) return true;
      if (filter.broadcasts && isChan)                return true;

      return false;
    });

    const finalGroups = filtered.map(dialogToGroup).filter(Boolean);
    console.log(`[folder-groups] folderId=${folderIdNum} → ${finalGroups.length} groups returned`);
    return res.json({ groups: finalGroups });

  } catch (e) {
    console.error('[folder-groups]', e);
    return res.status(500).json({ error: e.message || 'Failed' });
  } finally {
    releaseTelegramClient(account).catch(() => {});
  }
}
