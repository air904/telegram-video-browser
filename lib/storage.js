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
