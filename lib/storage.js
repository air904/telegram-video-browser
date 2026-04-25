/**
 * localStorage helpers for favorites and watched history.
 * All reads are safe on SSR (returns [] when window is undefined).
 */

const KEYS = { favorites: 'tg_favorites', watched: 'tg_watched' };
const MAX_WATCHED = 500;

function load(key) {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function save(key, data) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

// ─── Favorites ────────────────────────────────────────────────────────────────

export function getFavorites() { return load(KEYS.favorites); }

export function isFavorite(videoId) {
  return load(KEYS.favorites).some((v) => v.id === videoId);
}

export function addFavorite(video) {
  const list = load(KEYS.favorites);
  if (!list.find((v) => v.id === video.id)) {
    save(KEYS.favorites, [video, ...list]);
  }
}

export function removeFavorite(videoId) {
  save(KEYS.favorites, load(KEYS.favorites).filter((v) => v.id !== videoId));
}

export function toggleFavorite(video) {
  if (isFavorite(video.id)) { removeFavorite(video.id); return false; }
  addFavorite(video); return true;
}

// ─── Watched ──────────────────────────────────────────────────────────────────

export function getWatched() { return load(KEYS.watched); }

export function isWatched(videoId) {
  return load(KEYS.watched).some((v) => v.id === videoId);
}

export function addWatched(video) {
  const list = load(KEYS.watched).filter((v) => v.id !== video.id);
  const entry = { ...video, watchedAt: Date.now() };
  save(KEYS.watched, [entry, ...list].slice(0, MAX_WATCHED));
}

export function removeWatched(videoId) {
  save(KEYS.watched, load(KEYS.watched).filter((v) => v.id !== videoId));
}

export function clearWatched() {
  save(KEYS.watched, []);
}

export function getWatchedIds() {
  return new Set(load(KEYS.watched).map((v) => v.id));
}

// ─── Playlist（sessionStorage，用於影片頁滑動切換）────────────────────────────

export function savePlaylist(videos) {
  if (typeof window === 'undefined') return;
  try { sessionStorage.setItem('tg_playlist', JSON.stringify(videos)); } catch {}
}

export function getPlaylist() {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(sessionStorage.getItem('tg_playlist') || '[]'); } catch { return []; }
}

// ─── Video list cache（sessionStorage，避免從影片頁回首頁時重掃）──────────────
// 存影片清單 + 當時使用的 groupIds，回首頁時比對 groupIds 是否一致。
// sessionStorage 關分頁自動清除，30 分鐘後也自動失效。

const VIDEO_CACHE_KEY = 'tg_video_cache';
const VIDEO_CACHE_TTL = 30 * 60 * 1000; // 30 min

export function saveCachedVideos(videos, groupIdsJson) {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(VIDEO_CACHE_KEY, JSON.stringify({
      videos,
      groupIdsJson,
      ts: Date.now(),
    }));
  } catch {}
}

export function getCachedVideos(groupIdsJson) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(VIDEO_CACHE_KEY);
    if (!raw) return null;
    const { videos, groupIdsJson: cached, ts } = JSON.parse(raw);
    if (Date.now() - ts > VIDEO_CACHE_TTL) return null;   // 過期
    if (cached !== groupIdsJson) return null;              // 群組選擇已變
    return videos;
  } catch { return null; }
}

export function clearCachedVideos() {
  if (typeof window === 'undefined') return;
  try { sessionStorage.removeItem(VIDEO_CACHE_KEY); } catch {}
}

// ─── Group Selection（設定頁群組篩選）────────────────────────────────────────

export function getKnownGroups() {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem('tg_known_groups') || '[]'); } catch { return []; }
}
export function saveKnownGroups(groups) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem('tg_known_groups', JSON.stringify(groups)); } catch {}
}

// null = 顯示所有群組；string[] = 只顯示這些 chatId 的群組
export function getSelectedGroupIds() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('tg_selected_groups');
    return raw === null ? null : JSON.parse(raw);
  } catch { return null; }
}
export function saveSelectedGroupIds(ids) {
  if (typeof window === 'undefined') return;
  if (ids === null) { localStorage.removeItem('tg_selected_groups'); return; }
  try { localStorage.setItem('tg_selected_groups', JSON.stringify(ids)); } catch {}
}
