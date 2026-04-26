/**
 * Storage helpers: localStorage + sessionStorage + cookie
 * All reads are safe on SSR.
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

// ─── Cookie helpers ───────────────────────────────────────────────────────────

function cookieGet(name) {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function cookieSet(name, value, days = 365) {
  if (typeof document === 'undefined') return;
  const exp = new Date(Date.now() + days * 86400 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`;
}

function cookieDel(name) { cookieSet(name, '', -1); }

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

// ─── Selected Folder（cookie）────────────────────────────────────────────────
// null  = 未選擇（顯示引導）
// 0     = 所有聊天（Telegram 根目錄）
// N>0   = 特定文件夾 ID

export function getSelectedFolderId() {
  const v = cookieGet('tg_folder');
  if (v === null || v === '') return null;
  const n = parseInt(v);
  return isNaN(n) ? null : n;
}

export function saveSelectedFolderId(id) {
  if (id === null || id === undefined) cookieDel('tg_folder');
  else cookieSet('tg_folder', String(id));
}

// ─── Known Folders（localStorage cache）──────────────────────────────────────

export function getKnownFolders() {
  const raw = lsGet('tg_known_folders');
  // 正規化：確保 id 是數字、title 是字串（防止舊快取中的 TextWithEntities 物件）
  return raw.map(f => ({
    id:    typeof f.id === 'number' ? f.id : (parseInt(f.id) || 0),
    title: typeof f.title === 'string' ? f.title
           : (f.title?.text || `文件夾 ${f.id || '?'}`),
  }));
}
export function saveKnownFolders(folders){ lsSet('tg_known_folders', folders); }

// ─── Groups per folder（localStorage，Mode A 最佳化）─────────────────────────
// 儲存上次掃描該文件夾時找到的群組詳情，下次直接建 InputPeer 跳過 getDialogs

export function getFolderGroups(folderId) {
  return lsGet(`tg_fg_${folderId}`);
}
export function saveFolderGroups(folderId, groups) {
  lsSet(`tg_fg_${folderId}`, groups);
}
export function clearFolderGroups(folderId) {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(`tg_fg_${folderId}`); } catch {}
}

// ─── Selected groups within a folder ─────────────────────────────────────────
// null  = all groups in folder (default)
// array = specific group objects [{chatId, chatTitle, chatType, accessHash}]

export function getSelectedGroupsInFolder(folderId) {
  if (typeof window === 'undefined') return null;
  try {
    const v = localStorage.getItem(`tg_sel_${folderId}`);
    if (v === null) return null; // not set = all groups
    return JSON.parse(v);
  } catch { return null; }
}

export function saveSelectedGroupsInFolder(folderId, groups) {
  // groups: null = all groups in folder, or array of group objects
  if (typeof window === 'undefined') return;
  try {
    if (groups === null) {
      localStorage.removeItem(`tg_sel_${folderId}`);
    } else {
      localStorage.setItem(`tg_sel_${folderId}`, JSON.stringify(groups));
    }
  } catch {}
}
