/**
 * Storage helpers: localStorage + sessionStorage
 * All reads are safe on SSR.
 *
 * v2 — Per-account storage:
 *   All account-specific keys are prefixed with the accountId so that
 *   switching accounts reads the correct saved settings automatically.
 *
 *   Key layout:
 *     tg_folder_{accountId}              selected folder (null/0/N)
 *     tg_known_folders_{accountId}       folder list cache
 *     tg_fg_{accountId}_{folderId}       groups in a folder
 *     tg_sel_{accountId}_{folderId}      selected groups in a folder
 *     tg_video_cache                     sessionStorage, video list cache (cleared on switch)
 *     tg_favorites                       global (not per-account)
 *     tg_watched                         global (not per-account)
 *     tg_playlist                        sessionStorage
 */

// ─── localStorage helpers ─────────────────────────────────────────────────────

function lsGet(key, fallback = []) {
  if (typeof window === 'undefined') return fallback;
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
}
function lsSet(key, data) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}
function lsDel(key) {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(key); } catch {}
}

// ─── Favorites ────────────────────────────────────────────────────────────────

export function getFavorites()          { return lsGet('tg_favorites'); }
export function isFavorite(videoId)     { return lsGet('tg_favorites').some(v => v.id === videoId); }
export function addFavorite(video) {
  const list = lsGet('tg_favorites');
  if (!list.find(v => v.id === video.id)) lsSet('tg_favorites', [video, ...list]);
}
export function removeFavorite(videoId) { lsSet('tg_favorites', lsGet('tg_favorites').filter(v => v.id !== videoId)); }
export function toggleFavorite(video) {
  if (isFavorite(video.id)) { removeFavorite(video.id); return false; }
  addFavorite(video); return true;
}

// ─── Watched ──────────────────────────────────────────────────────────────────

const MAX_WATCHED = 500;
export function getWatched()            { return lsGet('tg_watched'); }
export function isWatched(videoId)      { return lsGet('tg_watched').some(v => v.id === videoId); }
export function addWatched(video) {
  const list = lsGet('tg_watched').filter(v => v.id !== video.id);
  lsSet('tg_watched', [{ ...video, watchedAt: Date.now() }, ...list].slice(0, MAX_WATCHED));
}
export function removeWatched(videoId)  { lsSet('tg_watched', lsGet('tg_watched').filter(v => v.id !== videoId)); }
export function clearWatched()          { lsSet('tg_watched', []); }
export function getWatchedIds()         { return new Set(lsGet('tg_watched').map(v => v.id)); }

// ─── Playlist（sessionStorage，影片頁滑動用）─────────────────────────────────

export function savePlaylist(videos) {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem('tg_playlist', JSON.stringify(videos)); } catch {}
}
export function getPlaylist() {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(sessionStorage.getItem('tg_playlist') || '[]'); } catch { return []; }
}

// ─── Video cache（sessionStorage，從影片頁返回時不重掃）──────────────────────

const VIDEO_CACHE_KEY = 'tg_video_cache';
const VIDEO_CACHE_TTL = 30 * 60 * 1000; // 30 min

export function saveCachedVideos(videos, cacheKey) {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem(VIDEO_CACHE_KEY, JSON.stringify({ videos, cacheKey, ts: Date.now() })); } catch {}
}
export function getCachedVideos(cacheKey) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(VIDEO_CACHE_KEY);
    if (!raw) return null;
    const { videos, cacheKey: cached, ts } = JSON.parse(raw);
    if (Date.now() - ts > VIDEO_CACHE_TTL) return null;
    if (cached !== cacheKey) return null;
    return videos;
  } catch { return null; }
}
export function clearCachedVideos() {
  if (typeof window === 'undefined') return;
  try { sessionStorage.removeItem(VIDEO_CACHE_KEY); } catch {}
}

// ─── Selected Folder（localStorage，per account）─────────────────────────────
// null  = 未選擇（顯示引導）
// 0     = 所有聊天（Telegram 根目錄）
// N>0   = 特定文件夾 ID

export function getSelectedFolderId(accountId) {
  if (!accountId) return null;
  const raw = localStorage.getItem(`tg_folder_${accountId}`);
  if (raw === null || raw === '') return null;
  const n = parseInt(JSON.parse(raw));
  return isNaN(n) ? null : n;
}

export function saveSelectedFolderId(id, accountId) {
  if (!accountId) return;
  if (id === null || id === undefined) lsDel(`tg_folder_${accountId}`);
  else lsSet(`tg_folder_${accountId}`, id);
}

// ─── Known Folders（localStorage cache，per account）─────────────────────────

export function getKnownFolders(accountId) {
  if (!accountId) return [];
  const raw = lsGet(`tg_known_folders_${accountId}`);
  // 正規化：確保 id 是數字、title 是字串
  return raw.map(f => ({
    id:    typeof f.id === 'number' ? f.id : (parseInt(f.id) || 0),
    title: typeof f.title === 'string' ? f.title
           : (f.title?.text || `文件夾 ${f.id || '?'}`),
  }));
}
export function saveKnownFolders(folders, accountId) {
  if (!accountId) return;
  lsSet(`tg_known_folders_${accountId}`, folders);
}

// ─── Groups per folder（localStorage，per account，Mode A 最佳化）────────────
// 儲存上次掃描該文件夾時找到的群組詳情，下次直接建 InputPeer 跳過 getDialogs

export function getFolderGroups(folderId, accountId) {
  if (!accountId) return lsGet(`tg_fg_${folderId}`);
  return lsGet(`tg_fg_${accountId}_${folderId}`);
}
export function saveFolderGroups(folderId, groups, accountId) {
  if (!accountId) { lsSet(`tg_fg_${folderId}`, groups); return; }
  lsSet(`tg_fg_${accountId}_${folderId}`, groups);
}
export function clearFolderGroups(folderId, accountId) {
  const key = accountId ? `tg_fg_${accountId}_${folderId}` : `tg_fg_${folderId}`;
  lsDel(key);
}

// ─── 清除特定帳號的所有快取（登出時使用）────────────────────────────────────

export function clearAllAccountCaches(accountId) {
  if (typeof window === 'undefined') return;
  try {
    if (accountId) {
      // 清除特定帳號的快取
      const keys = Object.keys(localStorage).filter(k =>
        k === `tg_folder_${accountId}` ||
        k === `tg_known_folders_${accountId}` ||
        k.startsWith(`tg_fg_${accountId}_`) ||
        k.startsWith(`tg_sel_${accountId}_`)
      );
      keys.forEach(k => localStorage.removeItem(k));
    } else {
      // 舊版相容：清除所有帳號快取（登出全部時）
      const keys = Object.keys(localStorage).filter(k =>
        k.startsWith('tg_fg_') || k.startsWith('tg_sel_') ||
        k.startsWith('tg_folder_') || k.startsWith('tg_known_folders_')
      );
      keys.forEach(k => localStorage.removeItem(k));
    }
  } catch {}
}

// ─── Selected groups within a folder（per account）───────────────────────────
// null  = all groups in folder (default)
// array = specific group objects [{chatId, chatTitle, chatType, accessHash}]

export function getSelectedGroupsInFolder(folderId, accountId) {
  if (typeof window === 'undefined') return null;
  const key = accountId ? `tg_sel_${accountId}_${folderId}` : `tg_sel_${folderId}`;
  try {
    const v = localStorage.getItem(key);
    if (v === null) return null; // not set = all groups
    return JSON.parse(v);
  } catch { return null; }
}

export function saveSelectedGroupsInFolder(folderId, groups, accountId) {
  if (typeof window === 'undefined') return;
  const key = accountId ? `tg_sel_${accountId}_${folderId}` : `tg_sel_${folderId}`;
  try {
    if (groups === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(groups));
  } catch {}
}
