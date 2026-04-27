/**
 * /video — 影片播放頁面
 * ・播放完畢自動跳下一支
 * ・螢幕上滑 → 下一支
 * ・螢幕下滑 → 上一支
 * ・螢幕右滑 → 快轉 +10 秒
 * ・螢幕左滑 → 快退 -10 秒
 * ・長按影片  → 2x 快速播放（放開恢復 1x）
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

function CastSpinner() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24"
      style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor"
        strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round" />
    </svg>
  );
}

function NavBar({ active }) {
  const items = [
    { href: '/', icon: '🏠', label: '首頁', key: 'home' },
    { href: '/favorites', icon: '❤️', label: '最愛', key: 'favorites' },
    { href: '/settings', icon: '⚙️', label: '設定', key: 'settings' },
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
    docId, docAccessHash, docFileRef,
    autoFullscreen,   // 'true' 時自動進入全螢幕（從全螢幕播完後自動跳下一支）
  } = query;

  const [fav, setFav]             = useState(false);
  const [toast, setToast]         = useState('');
  const [playlist, setPlaylist]   = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [seekHint,  setSeekHint]  = useState('');   // 'forward'|'back'
  const [seekAmount, setSeekAmount] = useState(0);  // 目前預計跳轉秒數（即時顯示）
  const [speedHint, setSpeedHint] = useState(false); // 2x 快速播放 overlay
  // ── 全螢幕 ──────────────────────────────────────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);
  // ── 投影（AirPlay / Remote Playback）────────────────────────────────────────
  // 'unavailable' | 'available' | 'connecting' | 'connected'
  const [castState, setCastState] = useState('unavailable');

  const toastTimer       = useRef(null);
  const touchStartY      = useRef(null);
  const touchStartX      = useRef(null);
  const videoRef         = useRef(null);
  const navigating       = useRef(false);
  const wasFullscreenRef = useRef(false); // 跳下一支前記錄是否在全螢幕
  // ── 長按計時 ─────────────────────────────────────────────────────────────────
  const longPressTimer         = useRef(null); // 上半部 500ms（加入最愛）／下半部 500ms（2x）
  const longPressDownloadTimer = useRef(null); // 上半部 3000ms（下載）
  const is2xMode               = useRef(false);
  const videoContainerRef      = useRef(null); // 影片容器（含黑邊）用於上下半判斷

  const videoId = chatId && msgId ? `${chatId}_${msgId}` : null;

  // ── 串流 URL（必須在所有 useEffect 之前定義，避免 TDZ ReferenceError）──────
  const streamUrl = chatId
    ? `/api/stream?chatId=${chatId}&msgId=${msgId}&accessHash=${encodeURIComponent(accessHash||'')}` +
      `&chatType=${chatType}&mimeType=${encodeURIComponent(mimeType||'video/mp4')}&accountId=${accountId}` +
      `&fileSize=${fileSize||0}` +
      `&docId=${encodeURIComponent(docId||'')}` +
      `&docAccessHash=${encodeURIComponent(docAccessHash||'')}` +
      `&docFileRef=${encodeURIComponent(docFileRef||'')}`
    : '';

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

  // ── 全螢幕狀態追蹤 ────────────────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => {
      const fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setIsFullscreen(fs);
      wasFullscreenRef.current = fs;
    };
    document.addEventListener('fullscreenchange',       onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange',       onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  // ── 自動全螢幕（從全螢幕播完後跳到下一支時觸發）─────────────────────────
  useEffect(() => {
    if (autoFullscreen !== 'true') return;
    const vid = videoRef.current;
    if (!vid) return;
    let done = false;
    const tryFS = () => {
      if (done) return; done = true;
      const req = vid.requestFullscreen || vid.webkitRequestFullscreen || vid.webkitEnterFullscreen;
      if (req) req.call(vid).catch(() => {});
    };
    // canplay 時觸發，或 500ms fallback
    vid.addEventListener('canplay', tryFS, { once: true });
    const t = setTimeout(tryFS, 500);
    return () => { vid.removeEventListener('canplay', tryFS); clearTimeout(t); };
  }, [autoFullscreen, streamUrl]); // eslint-disable-line

  // ── 投影可用性偵測（AirPlay + Remote Playback API）───────────────────────
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    // Remote Playback API（Chrome → Chromecast / Android TV）
    if (vid.remote) {
      vid.remote.watchAvailability(available => {
        if (available) setCastState(s => s === 'connected' ? s : 'available');
      }).catch(() => {});
      vid.remote.onconnecting = () => setCastState('connecting');
      vid.remote.onconnect    = () => setCastState('connected');
      vid.remote.ondisconnect = () => setCastState('available');
    }

    // AirPlay（Safari / iOS → Apple TV / AirPlay 電視）
    if (typeof window !== 'undefined' && window.WebKitPlaybackTargetAvailabilityEvent) {
      const onAP = (e) => {
        if (e.availability === 'available') setCastState(s => s === 'connected' ? s : 'available');
      };
      vid.addEventListener('webkitplaybacktargetavailabilitychanged', onAP);
      return () => vid.removeEventListener('webkitplaybacktargetavailabilitychanged', onAP);
    }
  }, [streamUrl]); // eslint-disable-line

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
      docId: video.docId || '', docAccessHash: video.docAccessHash || '',
      docFileRef: video.docFileRef || '',
      // 若目前在全螢幕，下一支也自動全螢幕
      autoFullscreen: wasFullscreenRef.current ? 'true' : 'false',
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

  // ── 觸控手勢偵測 ─────────────────────────────────────────────────────────────
  // 水平滑：≥40px 開始，每多 10px 多跳 10 秒（即時顯示）
  // 垂直滑：上 → 下一支，下 → 上一支
  // 長按影片上半部：儲存最愛 / 取消最愛
  // 長按影片下半部：2x 快速播放（放開恢復）

  /** 根據水平滑動距離計算跳轉秒數 */
  const calcSeek = (absX) => (Math.floor((absX - 40) / 10) + 1) * 10;

  const handleTouchStart = useCallback((e) => {
    touchStartY.current   = e.touches[0].clientY;
    touchStartX.current   = e.touches[0].clientX;
    clearTimeout(longPressTimer.current);
    clearTimeout(longPressDownloadTimer.current);

    // 在 touchstart 時判斷上下半部，分別啟動不同計時器
    const container = videoContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const ty = e.touches[0].clientY;
    const tx = e.touches[0].clientX;
    if (tx < rect.left || tx > rect.right || ty < rect.top || ty > rect.bottom) return;

    if (ty < rect.top + rect.height / 2) {
      // ── 上半部 ───────────────────────────────────────────────────────────
      // 500ms → 加入最愛
      longPressTimer.current = setTimeout(() => {
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
        showToast(added ? '❤️ 已加入最愛（繼續按 3 秒可下載）' : '🤍 已從最愛移除');
      }, 500);
      // 3000ms → 下載影片
      longPressDownloadTimer.current = setTimeout(() => {
        if (!chatId || !msgId) return;
        const dlUrl = `/api/stream?chatId=${chatId}&msgId=${msgId}` +
          `&accessHash=${encodeURIComponent(accessHash||'')}` +
          `&chatType=${chatType}&mimeType=${encodeURIComponent(mimeType||'video/mp4')}` +
          `&accountId=${accountId}&fileSize=${fileSize||0}` +
          `&docId=${encodeURIComponent(docId||'')}` +
          `&docAccessHash=${encodeURIComponent(docAccessHash||'')}` +
          `&docFileRef=${encodeURIComponent(docFileRef||'')}` +
          `&download=1&dlTitle=${encodeURIComponent(title || chatTitle || 'video')}`;
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = `${(title || chatTitle || 'video').replace(/[\\/:*?"<>|]/g, '_')}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast('⬇️ 開始下載影片…');
      }, 3000);
    } else {
      // ── 下半部：500ms → 2x 快速播放 ─────────────────────────────────────
      longPressTimer.current = setTimeout(() => {
        const vid = videoRef.current;
        if (!vid) return;
        is2xMode.current = true;
        vid.playbackRate = 2;
        setSpeedHint(true);
      }, 500);
    }
  }, [videoId, chatId, msgId, accessHash, chatType, mimeType, accountId,       // eslint-disable-line
      title, chatTitle, date, duration, fileSize, hasThumbnail,                 // eslint-disable-line
      docId, docAccessHash, docFileRef, showToast]);                            // eslint-disable-line

  const handleTouchMove = useCallback((e) => {
    if (touchStartY.current === null) return;
    const absY = Math.abs(touchStartY.current - e.touches[0].clientY);
    const absX = Math.abs(touchStartX.current - e.touches[0].clientX);

    // 手指移動 > 10px → 取消所有長按計時
    if (absY > 10 || absX > 10) {
      clearTimeout(longPressTimer.current);
      clearTimeout(longPressDownloadTimer.current);
    }

    // 水平滑動 → 快轉 / 快退提示（即時顯示秒數）
    if (absX > absY) {
      if (absX < 40) { setSeekHint(''); setSeekAmount(0); return; }
      const deltaX = touchStartX.current - e.touches[0].clientX;
      setSeekHint(deltaX > 0 ? 'back' : 'forward');
      setSeekAmount(calcSeek(absX));
    } else {
      setSeekHint(''); setSeekAmount(0);
    }
  }, []);

  /** 點擊影片左 / 右側切換影片（快速點擊 < 250ms 且移動 < 15px） */
  const handleTouchEnd = useCallback((e) => {
    clearTimeout(longPressTimer.current);
    clearTimeout(longPressDownloadTimer.current);

    // 放開時若在 2x 模式 → 恢復 1x
    if (is2xMode.current) {
      is2xMode.current = false;
      const vid = videoRef.current;
      if (vid) vid.playbackRate = 1;
      setSpeedHint(false);
      touchStartY.current = null;
      touchStartX.current = null;
      setSeekHint(''); setSeekAmount(0);
      return;
    }

    if (touchStartY.current === null) return;
    const deltaX  = touchStartX.current - e.changedTouches[0].clientX;
    const deltaY  = touchStartY.current - e.changedTouches[0].clientY;
    const absX    = Math.abs(deltaX);
    const absY    = Math.abs(deltaY);
    setSeekHint(''); setSeekAmount(0);

    // ── 水平滑動（快轉 / 快退）：absX >= 40px 且比垂直更明顯 ──────────────
    if (absX >= 40 && absX > absY * 1.5) {
      const vid = videoRef.current;
      if (vid) {
        const secs = calcSeek(absX);
        if (deltaX > 0) {
          vid.currentTime = Math.max(0, vid.currentTime - secs);
          showToast(`⏪ -${secs}秒`);
        } else {
          const dur = isFinite(vid.duration) ? vid.duration : vid.currentTime + secs;
          vid.currentTime = Math.min(dur, vid.currentTime + secs);
          showToast(`⏩ +${secs}秒`);
        }
      }
      touchStartY.current = null;
      touchStartX.current = null;
      return;
    }

    touchStartY.current = null;
    touchStartX.current = null;
  }, [showToast]);

  // ── 投影：Remote Playback API（Chromecast）先，再 AirPlay fallback ────────
  const handleCast = useCallback(async () => {
    const vid = videoRef.current;
    if (!vid) return;
    // Remote Playback API（Chromecast / Android TV）
    if (vid.remote) {
      try { await vid.remote.requestRemotePlayback(); return; } catch {}
    }
    // AirPlay picker（Apple TV / AirPlay 電視）
    if (vid.webkitShowPlaybackTargetPicker) {
      vid.webkitShowPlaybackTargetPicker();
    }
  }, []);

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
        @keyframes pulse { 0%,100% { opacity:0.7; transform:scale(1); } 50% { opacity:1; transform:scale(1.15); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes popIn { 0% { opacity:0; transform:translateX(-50%) scale(0.8); } 100% { opacity:1; transform:translateX(-50%) scale(1); } }
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
            onClick={() => {
              // 若在全螢幕先退出，再回上一頁（首頁）
              if (document.fullscreenElement || document.webkitFullscreenElement) {
                (document.exitFullscreen || document.webkitExitFullscreen || (() => {}))
                  .call(document)
                  .catch(() => {})
                  .finally(() => router.back());
              } else {
                router.back();
              }
            }}
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
          {/* 投影按鈕（AirPlay / Chromecast 可用時才顯示） */}
          {castState !== 'unavailable' && (
            <button
              onClick={handleCast}
              title={castState === 'connected' ? '投影中（點擊中斷）' : '投影到電視'}
              style={{ background: castState === 'connected' ? '#7c3aed22' : 'none',
                border: castState === 'connected' ? '1px solid #7c3aed55' : 'none',
                borderRadius: 8, padding: '4px 8px', cursor: 'pointer', flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 4,
                color: castState === 'connected' ? '#a78bfa'
                     : castState === 'connecting' ? '#71717a' : '#a1a1aa',
                fontSize: 13, fontWeight: 600, fontFamily: 'inherit',
                transition: 'all 0.2s' }}>
              {castState === 'connecting'
                ? <><CastSpinner />投影中…</>
                : castState === 'connected'
                  ? <>📺 投影中</>
                  : <>📺 投影</>
              }
            </button>
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
        <div ref={videoContainerRef} style={{ background: '#000', position: 'relative' }}>
          {isReady ? (
            <video
              ref={videoRef}
              key={streamUrl}
              src={streamUrl}
              controls
              autoPlay
              playsInline
              preload="auto"
              x-webkit-airplay="allow"
              onEnded={handleEnded}
              onWaiting={() => {}}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                width: '100%', maxHeight: '75vh', display: 'block',
                // 阻止 iOS/Android 長按彈出原生「儲存影片」對話框
                WebkitTouchCallout: 'none',
                WebkitUserSelect: 'none',
                userSelect: 'none',
              }}
            />
          ) : (
            <div style={{ width: '100%', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52525b', fontSize: 14 }}>
              載入中…
            </div>
          )}

          {/* 2x 快速播放 overlay */}
          {speedHint && (
            <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.75)', color: '#facc15', padding: '5px 16px',
              borderRadius: 20, fontSize: 15, fontWeight: 800, pointerEvents: 'none', zIndex: 20,
              letterSpacing: 1, animation: 'popIn 0.15s ease', whiteSpace: 'nowrap' }}>
              ▶▶ 2x 快速播放
            </div>
          )}

          {/* 快轉 / 快退 提示 overlay（即時顯示秒數） */}
          {seekHint && seekAmount > 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
              justifyContent: seekHint === 'forward' ? 'flex-end' : 'flex-start',
              pointerEvents: 'none', zIndex: 15, padding: '0 24px' }}>
              <div style={{ background: 'rgba(0,0,0,0.65)', borderRadius: 16, padding: '12px 20px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 30 }}>{seekHint === 'forward' ? '⏩' : '⏪'}</span>
                <span style={{ color: '#facc15', fontSize: 16, fontWeight: 800 }}>
                  {seekHint === 'forward' ? `+${seekAmount}秒` : `-${seekAmount}秒`}
                </span>
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
