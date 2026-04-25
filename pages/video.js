/**
 * /video — 影片播放頁面
 * ・播放完畢自動跳下一支
 * ・螢幕上滑 → 下一支
 * ・螢幕下滑 → 上一支
 */
import { useRouter } from 'next/router';
import { useEffect, useState, useRef, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { addWatched, isFavorite, toggleFavorite, getPlaylist } from '../lib/storage';

function fmtDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}
function fmtBytes(b) {
  if (!b) return '';
  if (b < 1024*1024) return `${(b/1024).toFixed(0)} KB`;
  if (b < 1024**3) return `${(b/1024/1024).toFixed(1)} MB`;
  return `${(b/1024**3).toFixed(2)} GB`;
}
function fmtDate(unix) {
  if (!unix) return '';
  return new Date(unix * 1000).toLocaleDateString('zh-TW', { year:'numeric', month:'short', day:'numeric' });
}

function NavBar({ active }) {
  const items = [
    { href: '/', icon: '🏠', label: '首頁', key: 'home' },
    { href: '/favorites', icon: '❤️', label: '最愛', key: 'favorites' },
  ];
  return (
    <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100, background: 'rgba(13,13,15,0.96)', backdropFilter: 'blur(14px)', borderTop: '1px solid #1f1f23', display: 'flex', height: 58 }}>
      {items.map(item => (
        <Link key={item.key} href={item.href} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: active === item.key ? '#a78bfa' : '#52525b', textDecoration: 'none', fontSize: 11, fontWeight: 600, transition: 'color 0.15s' }}>
          <span style={{ fontSize: 22 }}>{item.icon}</span>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export default function VideoPage() {
  const router = useRouter();
  const query = router.query;

  const {
    chatId, msgId, accessHash, chatType, mimeType, accountId,
    title, chatTitle, date, duration, fileSize, hasThumbnail,
  } = query;

  const [fav, setFav] = useState(false);
  const [toast, setToast] = useState('');
  const [playlist, setPlaylist] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [swipeHint, setSwipeHint] = useState(''); // 'next' | 'prev' | ''
  const toastTimer = useRef(null);
  const swipeHintTimer = useRef(null);
  const touchStartY = useRef(null);
  const touchStartX = useRef(null);
  const videoRef = useRef(null);
  const navigating = useRef(false);

  const videoId = chatId && msgId ? `${chatId}_${msgId}` : null;

  // Load playlist on mount
  useEffect(() => {
    const list = getPlaylist();
    setPlaylist(list);
  }, []);

  // Update currentIndex when videoId or playlist changes
  useEffect(() => {
    if (!videoId || playlist.length === 0) return;
    const idx = playlist.findIndex((v) => v.id === videoId);
    setCurrentIndex(idx);
  }, [videoId, playlist]);

  // Mark as watched + load favorites state
  useEffect(() => {
    if (!chatId || !msgId || !accountId) return;
    const video = {
      id: videoId, chatId, msgId, accessHash, chatType,
      mimeType: mimeType || 'video/mp4', accountId,
      title: title || '', chatTitle: chatTitle || '',
      date: parseInt(date) || 0, duration: parseInt(duration) || 0,
      fileSize: parseInt(fileSize) || 0, hasThumbnail: hasThumbnail === 'true',
    };
    addWatched(video);
    setFav(isFavorite(videoId));
    navigating.current = false;
  }, [chatId, msgId, accountId]);

  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2000);
  }, []);

  // Navigate to a video in the playlist
  const navigateTo = useCallback((video) => {
    if (!video || navigating.current) return;
    navigating.current = true;
    const p = new URLSearchParams({
      chatId: video.chatId, msgId: video.msgId,
      accessHash: video.accessHash || '', chatType: video.chatType || '',
      mimeType: video.mimeType || 'video/mp4', accountId: video.accountId || '',
      title: video.title || '', chatTitle: video.chatTitle || '',
      date: video.date || 0, duration: video.duration || 0,
      fileSize: video.fileSize || 0, hasThumbnail: video.hasThumbnail ? 'true' : 'false',
    });
    router.replace(`/video?${p}`);
  }, [router]);

  const goNext = useCallback(() => {
    if (currentIndex < 0 || currentIndex >= playlist.length - 1) {
      showToast('已是最後一支影片');
      return;
    }
    navigateTo(playlist[currentIndex + 1]);
  }, [currentIndex, playlist, navigateTo, showToast]);

  const goPrev = useCallback(() => {
    if (currentIndex <= 0) {
      showToast('已是第一支影片');
      return;
    }
    navigateTo(playlist[currentIndex - 1]);
  }, [currentIndex, playlist, navigateTo, showToast]);

  // Auto-play next when video ends
  const handleEnded = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < playlist.length - 1) {
      showToast('自動播放下一支…');
      setTimeout(() => goNext(), 800);
    } else {
      showToast('播放清單已結束');
    }
  }, [currentIndex, playlist, goNext, showToast]);

  // Touch swipe detection
  const handleTouchStart = useCallback((e) => {
    touchStartY.current = e.touches[0].clientY;
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (touchStartY.current === null) return;
    const deltaY = touchStartY.current - e.touches[0].clientY;
    if (Math.abs(deltaY) < 30) { setSwipeHint(''); return; }
    const hint = deltaY > 0 ? 'next' : 'prev';
    if (hint !== swipeHint) {
      setSwipeHint(hint);
      clearTimeout(swipeHintTimer.current);
      swipeHintTimer.current = setTimeout(() => setSwipeHint(''), 1200);
    }
  }, [swipeHint]);

  const handleTouchEnd = useCallback((e) => {
    if (touchStartY.current === null) return;
    const deltaY = touchStartY.current - e.changedTouches[0].clientY;
    const deltaX = touchStartX.current - e.changedTouches[0].clientX;
    setSwipeHint('');

    // Require mostly-vertical swipe, >= 60px
    if (Math.abs(deltaY) < 60 || Math.abs(deltaY) < Math.abs(deltaX) * 1.5) {
      touchStartY.current = null;
      touchStartX.current = null;
      return;
    }
    if (deltaY > 0) {
      goNext();
    } else {
      goPrev();
    }
    touchStartY.current = null;
    touchStartX.current = null;
  }, [goNext, goPrev]);

  const handleFav = () => {
    if (!videoId) return;
    const video = {
      id: videoId, chatId, msgId, accessHash, chatType,
      mimeType: mimeType || 'video/mp4', accountId,
      title: title || '', chatTitle: chatTitle || '',
      date: parseInt(date) || 0, duration: parseInt(duration) || 0,
      fileSize: parseInt(fileSize) || 0, hasThumbnail: hasThumbnail === 'true',
    };
    const added = toggleFavorite(video);
    setFav(added);
    showToast(added ? '❤️ 已加入最愛' : '🤍 已從最愛移除');
  };

  const streamUrl = chatId
    ? `/api/stream?chatId=${chatId}&msgId=${msgId}&accessHash=${encodeURIComponent(accessHash||'')}&chatType=${chatType}&mimeType=${encodeURIComponent(mimeType||'video/mp4')}&accountId=${accountId}`
    : '';

  const isReady = !!chatId;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < playlist.length - 1;
  const posLabel = currentIndex >= 0 && playlist.length > 1
    ? `${currentIndex + 1} / ${playlist.length}`
    : '';

  return (
    <>
      <Head>
        <title>{title || '影片播放'} — Telegram 影片瀏覽器</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d0f; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: #2e2e35; border-radius: 3px; }
        @keyframes fadeSlideUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
        @keyframes fadeSlideDown { from { opacity:0; transform:translateY(-12px); } to { opacity:1; transform:none; } }
        @keyframes pulse { 0%,100% { opacity:0.7; transform:scale(1); } 50% { opacity:1; transform:scale(1.15); } }
      `}</style>

      {/* Full-page swipe container */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}
      >
        {/* Header */}
        <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(13,13,15,0.9)', backdropFilter: 'blur(14px)', borderBottom: '1px solid #1f1f23', display: 'flex', alignItems: 'center', padding: '0 16px', height: 56, gap: 12 }}>
          <button
            onClick={() => router.back()}
            style={{ background: 'none', color: '#a1a1aa', fontSize: 22, cursor: 'pointer', padding: '4px 8px', borderRadius: 8, lineHeight: 1, flexShrink: 0 }}
          >
            ←
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || '影片播放'}</p>
            <p style={{ fontSize: 11, color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chatTitle}</p>
          </div>
          {posLabel && (
            <span style={{ fontSize: 11, color: '#52525b', flexShrink: 0, whiteSpace: 'nowrap' }}>{posLabel}</span>
          )}
          <button
            onClick={handleFav}
            title={fav ? '從最愛移除' : '加入最愛'}
            style={{ background: 'none', fontSize: 24, cursor: 'pointer', padding: 6, lineHeight: 1, flexShrink: 0, transition: 'transform 0.15s', transform: fav ? 'scale(1.2)' : 'scale(1)' }}
          >
            {fav ? '❤️' : '🤍'}
          </button>
        </header>

        {/* Video player */}
        <div style={{ background: '#000', position: 'relative' }}>
          {isReady ? (
            <video
              ref={videoRef}
              key={streamUrl}
              src={streamUrl}
              controls
              autoPlay
              playsInline
              onEnded={handleEnded}
              style={{ width: '100%', maxHeight: '75vh', display: 'block' }}
            />
          ) : (
            <div style={{ width: '100%', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52525b', fontSize: 14 }}>
              載入中…
            </div>
          )}

          {/* Swipe hint overlay — next */}
          {swipeHint === 'next' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', pointerEvents: 'none', animation: 'fadeSlideUp 0.15s ease' }}>
              <div style={{ textAlign: 'center', color: '#fff' }}>
                <div style={{ fontSize: 38, animation: 'pulse 0.6s infinite' }}>⬆︎</div>
                <p style={{ fontSize: 14, marginTop: 8, color: '#a78bfa', fontWeight: 700 }}>
                  {hasNext ? '下一支' : '已是最後一支'}
                </p>
                {hasNext && (
                  <p style={{ fontSize: 11, color: '#a1a1aa', marginTop: 4, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {playlist[currentIndex + 1]?.title || ''}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Swipe hint overlay — prev */}
          {swipeHint === 'prev' && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', pointerEvents: 'none', animation: 'fadeSlideDown 0.15s ease' }}>
              <div style={{ textAlign: 'center', color: '#fff' }}>
                <div style={{ fontSize: 38, animation: 'pulse 0.6s infinite' }}>⬇︎</div>
                <p style={{ fontSize: 14, marginTop: 8, color: '#a78bfa', fontWeight: 700 }}>
                  {hasPrev ? '上一支' : '已是第一支'}
                </p>
                {hasPrev && (
                  <p style={{ fontSize: 11, color: '#a1a1aa', marginTop: 4, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {playlist[currentIndex - 1]?.title || ''}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Info panel */}
        <div style={{ padding: '16px', paddingBottom: 80, flex: 1 }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.4, marginBottom: 10 }}>{title || '影片'}</h1>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', marginBottom: 16 }}>
            {chatTitle && <span style={{ color: '#a78bfa', fontSize: 13 }}>📡 {chatTitle}</span>}
            {date && <span style={{ color: '#71717a', fontSize: 13 }}>📅 {fmtDate(parseInt(date))}</span>}
            {parseInt(duration) > 0 && <span style={{ color: '#71717a', fontSize: 13 }}>⏱ {fmtDuration(parseInt(duration))}</span>}
            {parseInt(fileSize) > 0 && <span style={{ color: '#71717a', fontSize: 13 }}>💾 {fmtBytes(parseInt(fileSize))}</span>}
          </div>

          {/* Favorite button */}
          <button onClick={handleFav} style={{
            width: '100%', padding: '12px', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer',
            background: fav ? '#7c3aed22' : '#18181b',
            border: `1px solid ${fav ? '#7c3aed' : '#2e2e35'}`,
            color: fav ? '#a78bfa' : '#71717a',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            transition: 'all 0.2s', marginBottom: 12,
            fontFamily: 'inherit',
          }}>
            {fav ? '❤️ 已加入最愛' : '🤍 加入最愛'}
          </button>

          {/* Prev / Next buttons */}
          {playlist.length > 1 && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <button
                onClick={goPrev}
                disabled={!hasPrev}
                style={{
                  flex: 1, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 600,
                  background: hasPrev ? '#18181b' : 'transparent',
                  border: `1px solid ${hasPrev ? '#2e2e35' : '#1f1f23'}`,
                  color: hasPrev ? '#a1a1aa' : '#3f3f46',
                  cursor: hasPrev ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.15s', fontFamily: 'inherit',
                }}
              >
                ← 上一支
              </button>
              <button
                onClick={goNext}
                disabled={!hasNext}
                style={{
                  flex: 1, padding: '11px', borderRadius: 12, fontSize: 13, fontWeight: 600,
                  background: hasNext ? '#18181b' : 'transparent',
                  border: `1px solid ${hasNext ? '#2e2e35' : '#1f1f23'}`,
                  color: hasNext ? '#a1a1aa' : '#3f3f46',
                  cursor: hasNext ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.15s', fontFamily: 'inherit',
                }}
              >
                下一支 →
              </button>
            </div>
          )}

          {/* Next video preview card */}
          {hasNext && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: '#18181b', border: '1px solid #27272b', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18, opacity: 0.4, flexShrink: 0 }}>▶</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 10, color: '#52525b', marginBottom: 2 }}>接下來播放</p>
                <p style={{ fontSize: 12, color: '#a1a1aa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {playlist[currentIndex + 1]?.title || '下一支影片'}
                </p>
              </div>
              <button
                onClick={goNext}
                style={{ background: '#7c3aed', color: '#fff', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit', border: 'none' }}
              >
                播放
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 72, left: '50%', transform: 'translateX(-50%)', background: '#27272b', border: '1px solid #3f3f46', color: '#f4f4f5', padding: '10px 22px', borderRadius: 24, fontSize: 13, zIndex: 2000, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}>
          {toast}
        </div>
      )}

      <NavBar active="home" />
    </>
  );
}
