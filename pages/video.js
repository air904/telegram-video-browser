/**
 * /video — 影片全螢幕播放頁面 v4
 *
 * 全螢幕：mount 後立即呼叫 requestFullscreen（Android/Chrome）；
 *         first-touch 時再試一次（保證在 user-gesture context 內）。
 *         iOS Safari 不支援 Fullscreen API，退回 CSS 全覆蓋。
 *
 * 手勢規則：
 *   上滑 (≥ 60px)               → 下一支
 *   下滑 (≥ 60px)               → 上一支
 *   長按上 1/3 螢幕 500ms       → 加入 / 取消最愛
 *   長按上 1/3 螢幕 3000ms      → 下載影片
 *   長按下 2/3 螢幕 500ms       → 2x 倍速（放開恢復 1x）
 *   輕按 (< 250ms, 移動 < 15px) → 顯示 / 隱藏進度列（3 秒自動收起）
 */
import { useRouter }                       from 'next/router';
import { useEffect, useState, useRef, useCallback } from 'react';
import Head                                from 'next/head';
import { addWatched, isFavorite, toggleFavorite, getPlaylist } from '../lib/storage';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDuration(secs) {
  if (!secs || isNaN(secs)) return '0:00';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = Math.floor(secs % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
    : `${m}:${String(s).padStart(2,'0')}`;
}
function fmtBytes(b) {
  if (!b) return '';
  if (b < 1024*1024) return `${(b/1024).toFixed(0)} KB`;
  if (b < 1024**3)   return `${(b/1024/1024).toFixed(1)} MB`;
  return `${(b/1024**3).toFixed(2)} GB`;
}
function CastSpinner() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24"
      style={{ animation:'spin 0.8s linear infinite', flexShrink:0 }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor"
        strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/>
    </svg>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function VideoPage() {
  const router = useRouter();
  const query  = router.query;
  const {
    chatId, msgId, accessHash, chatType, mimeType, accountId,
    title, chatTitle, date, duration, fileSize, hasThumbnail,
    docId, docAccessHash, docFileRef,
  } = query;

  // ── State ──────────────────────────────────────────────────────────────────
  const [fav,           setFav]          = useState(false);
  const [toast,         setToast]        = useState('');
  const [playlist,      setPlaylist]     = useState([]);
  const [currentIndex,  setCurrentIndex] = useState(-1);
  const [speedHint,     setSpeedHint]    = useState(false);
  const [paused,        setPaused]       = useState(false);
  const [castState,     setCastState]    = useState('unavailable');
  // 進度列
  const [showScrubber,  setShowScrubber] = useState(false);
  const [currentTime,   setCurrentTime]  = useState(0);
  const [videoDuration, setVideoDuration]= useState(0);
  const [zoom,          setZoom]         = useState({ scale: 1, x: 0, y: 0 }); // 觸發 re-render 用

  // ── Refs ───────────────────────────────────────────────────────────────────
  const videoRef        = useRef(null);
  const navigating      = useRef(false);
  const toastTimer      = useRef(null);
  const touchStartY     = useRef(null);
  const touchStartX     = useRef(null);
  const touchStartTime  = useRef(null);
  const lpTopTimer      = useRef(null);
  const lpTopDlTimer    = useRef(null);
  const lpBotTimer      = useRef(null);
  const is2xMode        = useRef(false);
  const lpFired         = useRef(false);
  const scrubberTimer   = useRef(null);
  const scrubberVisible = useRef(false);  // 給 handleTouchEnd 讀的同步版本
  // ── Pinch-to-zoom refs ─────────────────────────────────────────────────────
  const zoomRef         = useRef({ scale: 1, x: 0, y: 0 }); // real-time（不觸發 re-render）
  const pinchStartDist  = useRef(null);
  const pinchStartScale = useRef(1);
  const isPinching      = useRef(false);
  const panStart        = useRef(null);   // 放大後單指平移的起始位置

  // ── Stream URL ─────────────────────────────────────────────────────────────
  const videoId   = chatId && msgId ? `${chatId}_${msgId}` : null;
  const streamUrl = chatId
    ? `/api/stream?chatId=${chatId}&msgId=${msgId}` +
      `&accessHash=${encodeURIComponent(accessHash||'')}` +
      `&chatType=${chatType}&mimeType=${encodeURIComponent(mimeType||'video/mp4')}` +
      `&accountId=${accountId}&fileSize=${fileSize||0}` +
      `&docId=${encodeURIComponent(docId||'')}` +
      `&docAccessHash=${encodeURIComponent(docAccessHash||'')}` +
      `&docFileRef=${encodeURIComponent(docFileRef||'')}`
    : '';

  // ── 自動全螢幕（mount + first touch）──────────────────────────────────────
  useEffect(() => {
    const tryFs = () => {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    };
    tryFs(); // 立即嘗試（SPA 跳頁後部分瀏覽器仍視為 gesture context）
    window.addEventListener('touchstart', tryFs, { once: true, passive: true });

    return () => {
      window.removeEventListener('touchstart', tryFs);
      // 離開影片頁時退出全螢幕
      try {
        if (document.fullscreenElement && document.exitFullscreen)
          document.exitFullscreen().catch(() => {});
        else if (document.webkitFullscreenElement && document.webkitExitFullscreen)
          document.webkitExitFullscreen();
      } catch {}
    };
  }, []);

  // ── 立即播放：不等 buffer，多點觸發確保在所有環境啟動 ──────────────────────
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !streamUrl) return;
    const tryPlay = () => vid.play().catch(() => {});
    tryPlay();                                           // mount 後立即嘗試
    vid.addEventListener('loadstart',    tryPlay, { once: true });
    vid.addEventListener('loadeddata',   tryPlay, { once: true });
    vid.addEventListener('canplay',      tryPlay, { once: true });
    return () => {
      vid.removeEventListener('loadstart',  tryPlay);
      vid.removeEventListener('loadeddata', tryPlay);
      vid.removeEventListener('canplay',    tryPlay);
    };
  }, [streamUrl]);

  // ── playlist ───────────────────────────────────────────────────────────────
  useEffect(() => { setPlaylist(getPlaylist()); }, []);
  useEffect(() => {
    if (!videoId || !playlist.length) return;
    setCurrentIndex(playlist.findIndex(v => v.id === videoId));
  }, [videoId, playlist]);

  // ── Watched + fav ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chatId || !msgId || !accountId) return;
    addWatched({
      id: videoId, chatId, msgId, accessHash, chatType,
      mimeType: mimeType||'video/mp4', accountId,
      title: title||'', chatTitle: chatTitle||'',
      date: parseInt(date)||0, duration: parseInt(duration)||0,
      fileSize: parseInt(fileSize)||0, hasThumbnail: hasThumbnail==='true',
    });
    setFav(isFavorite(videoId));
    navigating.current = false;
  }, [chatId, msgId, accountId]); // eslint-disable-line

  // ── Cast ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.remote) {
      vid.remote.watchAvailability(ok => {
        if (ok) setCastState(s => s === 'connected' ? s : 'available');
      }).catch(() => {});
      vid.remote.onconnecting = () => setCastState('connecting');
      vid.remote.onconnect    = () => setCastState('connected');
      vid.remote.ondisconnect = () => setCastState('available');
    }
    if (typeof window !== 'undefined' && window.WebKitPlaybackTargetAvailabilityEvent) {
      const onAP = e => {
        if (e.availability === 'available') setCastState(s => s === 'connected' ? s : 'available');
      };
      vid.addEventListener('webkitplaybacktargetavailabilitychanged', onAP);
      return () => vid.removeEventListener('webkitplaybacktargetavailabilitychanged', onAP);
    }
  }, [streamUrl]); // eslint-disable-line

  // ── 進度列 helpers ─────────────────────────────────────────────────────────
  const showScrubberFor3s = useCallback(() => {
    scrubberVisible.current = true;
    setShowScrubber(true);
    clearTimeout(scrubberTimer.current);
    scrubberTimer.current = setTimeout(() => {
      scrubberVisible.current = false;
      setShowScrubber(false);
    }, 3000);
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const vid = videoRef.current;
    if (vid) setCurrentTime(vid.currentTime);
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    const vid = videoRef.current;
    if (vid) setVideoDuration(vid.duration || 0);
  }, []);

  // ── Toast / navigation ─────────────────────────────────────────────────────
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2500);
  }, []);

  const clearAllLpTimers = useCallback(() => {
    clearTimeout(lpTopTimer.current);
    clearTimeout(lpTopDlTimer.current);
    clearTimeout(lpBotTimer.current);
  }, []);

  const navigateTo = useCallback((video) => {
    if (!video || navigating.current) return;
    navigating.current = true;
    const p = new URLSearchParams({
      chatId: video.chatId, msgId: video.msgId,
      accessHash: video.accessHash||'', chatType: video.chatType||'',
      mimeType: video.mimeType||'video/mp4', accountId: video.accountId||'',
      title: video.title||'', chatTitle: video.chatTitle||'',
      date: video.date||0, duration: video.duration||0,
      fileSize: video.fileSize||0, hasThumbnail: video.hasThumbnail?'true':'false',
      docId: video.docId||'', docAccessHash: video.docAccessHash||'',
      docFileRef: video.docFileRef||'',
    });
    router.replace(`/video?${p}`);
  }, [router]);

  const goNext = useCallback(() => {
    if (currentIndex < 0 || currentIndex >= playlist.length - 1) {
      showToast('已是最後一支影片'); return;
    }
    navigateTo(playlist[currentIndex + 1]);
  }, [currentIndex, playlist, navigateTo, showToast]);

  const goPrev = useCallback(() => {
    if (currentIndex <= 0) { showToast('已是第一支影片'); return; }
    navigateTo(playlist[currentIndex - 1]);
  }, [currentIndex, playlist, navigateTo, showToast]);

  const handleEnded = useCallback(() => {
    if (currentIndex >= 0 && currentIndex < playlist.length - 1) {
      showToast('自動播放下一支…');
      setTimeout(() => goNext(), 800);
    } else { showToast('播放清單已結束'); }
  }, [currentIndex, playlist, goNext, showToast]);

  const handleCast = useCallback(async () => {
    const vid = videoRef.current; if (!vid) return;
    if (vid.remote) { try { await vid.remote.requestRemotePlayback(); return; } catch {} }
    if (vid.webkitShowPlaybackTargetPicker) vid.webkitShowPlaybackTargetPicker();
  }, []);

  // ── Zoom 重置 helper ───────────────────────────────────────────────────────
  const resetZoom = useCallback(() => {
    zoomRef.current = { scale: 1, x: 0, y: 0 };
    setZoom({ scale: 1, x: 0, y: 0 });
  }, []);

  // ── 觸控手勢 ───────────────────────────────────────────────────────────────
  const handleTouchStart = useCallback((e) => {
    // ── 雙指 pinch 開始 ──────────────────────────────────────────────────────
    if (e.touches.length === 2) {
      isPinching.current = true;
      clearAllLpTimers();
      touchStartY.current = null; // 取消單指狀態
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      pinchStartDist.current  = Math.hypot(dx, dy);
      pinchStartScale.current = zoomRef.current.scale;
      return;
    }

    const touch = e.touches[0];
    touchStartY.current    = touch.clientY;
    touchStartX.current    = touch.clientX;
    touchStartTime.current = Date.now();
    lpFired.current        = false;
    clearAllLpTimers();

    // 放大後記錄平移起點（單指拖曳用）
    if (zoomRef.current.scale > 1) {
      panStart.current = { x: touch.clientX, y: touch.clientY };
    }

    const isTopZone = touch.clientY < window.innerHeight / 3;

    if (isTopZone) {
      // 500ms → 最愛
      lpTopTimer.current = setTimeout(() => {
        lpFired.current = true;
        if (!videoId) return;
        const video = {
          id: videoId, chatId, msgId, accessHash, chatType,
          mimeType: mimeType||'video/mp4', accountId,
          title: title||'', chatTitle: chatTitle||'',
          date: parseInt(date)||0, duration: parseInt(duration)||0,
          fileSize: parseInt(fileSize)||0, hasThumbnail: hasThumbnail==='true',
        };
        const added = toggleFavorite(video);
        setFav(added);
        showToast(added ? '❤️ 已加入最愛（繼續按 3 秒可下載）' : '🤍 已從最愛移除');
      }, 500);
      // 3000ms → 下載
      lpTopDlTimer.current = setTimeout(() => {
        lpFired.current = true;
        if (!chatId || !msgId) return;
        const dlUrl = `/api/stream?chatId=${chatId}&msgId=${msgId}` +
          `&accessHash=${encodeURIComponent(accessHash||'')}` +
          `&chatType=${chatType}&mimeType=${encodeURIComponent(mimeType||'video/mp4')}` +
          `&accountId=${accountId}&fileSize=${fileSize||0}` +
          `&docId=${encodeURIComponent(docId||'')}` +
          `&docAccessHash=${encodeURIComponent(docAccessHash||'')}` +
          `&docFileRef=${encodeURIComponent(docFileRef||'')}` +
          `&download=1&dlTitle=${encodeURIComponent(title||chatTitle||'video')}`;
        const a = document.createElement('a');
        a.href = dlUrl;
        a.download = `${(title||chatTitle||'video').replace(/[\\/:*?"<>|]/g,'_')}.mp4`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        showToast('⬇️ 開始下載影片…');
      }, 3000);
    } else {
      // 500ms → 2x 倍速
      lpBotTimer.current = setTimeout(() => {
        lpFired.current = true;
        const vid = videoRef.current; if (!vid) return;
        is2xMode.current = true;
        vid.playbackRate = 2;
        setSpeedHint(true);
      }, 500);
    }
  }, [videoId, chatId, msgId, accessHash, chatType, mimeType, accountId, // eslint-disable-line
      title, chatTitle, date, duration, fileSize, hasThumbnail,           // eslint-disable-line
      docId, docAccessHash, docFileRef, showToast, clearAllLpTimers]);    // eslint-disable-line

  const handleTouchMove = useCallback((e) => {
    // ── 雙指 pinch 縮放 ───────────────────────────────────────────────────────
    if (e.touches.length === 2) {
      isPinching.current = true;
      if (pinchStartDist.current === null) return;
      const dx   = e.touches[1].clientX - e.touches[0].clientX;
      const dy   = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.hypot(dx, dy);
      const newScale = Math.max(1, Math.min(5, pinchStartScale.current * (dist / pinchStartDist.current)));
      const newZoom  = { ...zoomRef.current, scale: newScale };
      // 縮回 1x 時把平移也清零
      if (newScale <= 1) { newZoom.x = 0; newZoom.y = 0; }
      zoomRef.current = newZoom;
      setZoom({ ...newZoom });
      return;
    }

    // ── 放大後單指平移 ────────────────────────────────────────────────────────
    if (zoomRef.current.scale > 1 && panStart.current) {
      const touch = e.touches[0];
      const dx = touch.clientX - panStart.current.x;
      const dy = touch.clientY - panStart.current.y;
      panStart.current = { x: touch.clientX, y: touch.clientY };
      const maxX = (zoomRef.current.scale - 1) * window.innerWidth  / 2;
      const maxY = (zoomRef.current.scale - 1) * window.innerHeight / 2;
      const newX = Math.max(-maxX, Math.min(maxX, zoomRef.current.x + dx));
      const newY = Math.max(-maxY, Math.min(maxY, zoomRef.current.y + dy));
      zoomRef.current = { ...zoomRef.current, x: newX, y: newY };
      setZoom({ ...zoomRef.current });
      return; // 平移期間不觸發長按取消
    }

    // ── 原始單指手勢 ──────────────────────────────────────────────────────────
    if (touchStartY.current === null) return;
    const absY = Math.abs(e.touches[0].clientY - touchStartY.current);
    const absX = Math.abs(e.touches[0].clientX - touchStartX.current);
    if (absY > 15 || absX > 15) clearAllLpTimers();
  }, [clearAllLpTimers]);

  const handleTouchEnd = useCallback((e) => {
    clearAllLpTimers();

    // ── 雙指 pinch 結束 ────────────────────────────────────────────────────────
    if (isPinching.current) {
      isPinching.current = false;
      panStart.current   = null;
      touchStartY.current = null;
      // 縮到接近 1x 時直接 reset
      if (zoomRef.current.scale < 1.05) resetZoom();
      return;
    }

    // ── 放大後單指平移結束（跳過滑動切換）────────────────────────────────────
    if (zoomRef.current.scale > 1) {
      panStart.current    = null;
      touchStartY.current = null;
      return;
    }

    // 2x 模式放開 → 恢復 1x
    if (is2xMode.current) {
      is2xMode.current = false;
      const vid = videoRef.current;
      if (vid) vid.playbackRate = 1;
      setSpeedHint(false);
      touchStartY.current = null;
      return;
    }

    if (touchStartY.current === null) return;
    const end     = e.changedTouches[0];
    const deltaY  = touchStartY.current - end.clientY;
    const deltaX  = touchStartX.current - end.clientX;
    const absY    = Math.abs(deltaY);
    const absX    = Math.abs(deltaX);
    const elapsed = Date.now() - (touchStartTime.current || 0);
    touchStartY.current = null;

    // 垂直滑動 ≥ 60px → 切換影片
    if (absY >= 60 && absY > absX * 1.5) {
      if (deltaY > 0) goNext();
      else            goPrev();
      return;
    }

    // 輕按 → 顯示 / 隱藏進度列
    if (!lpFired.current && elapsed < 250 && absX < 15 && absY < 15) {
      if (scrubberVisible.current) {
        scrubberVisible.current = false;
        clearTimeout(scrubberTimer.current);
        setShowScrubber(false);
      } else {
        showScrubberFor3s();
      }
    }
  }, [goNext, goPrev, clearAllLpTimers, showScrubberFor3s, resetZoom]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const isReady  = !!chatId;
  const hasPrev  = currentIndex > 0;
  const hasNext  = currentIndex >= 0 && currentIndex < playlist.length - 1;
  const posLabel = currentIndex >= 0 && playlist.length > 1
    ? `${currentIndex + 1} / ${playlist.length}` : '';
  const progress = videoDuration > 0 ? (currentTime / videoDuration) * 100 : 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>{title || '影片播放'} — Telegram 影片瀏覽器</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
      </Head>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body { background: #000; overflow: hidden; width: 100%; height: 100%; }
        @keyframes spin  { to { transform: rotate(360deg); } }
        @keyframes popIn { from { opacity:0; transform:translate(-50%,-50%) scale(0.85); } to { opacity:1; transform:translate(-50%,-50%) scale(1); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:none; } }
        /* 進度條樣式 */
        .scrubber-range {
          -webkit-appearance: none; appearance: none;
          width: 100%; height: 4px; border-radius: 2px;
          background: linear-gradient(to right, #a78bfa ${progress}%, rgba(255,255,255,0.25) ${progress}%);
          outline: none; cursor: pointer;
        }
        .scrubber-range::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 18px; height: 18px; border-radius: 50%;
          background: #a78bfa; box-shadow: 0 0 6px rgba(167,139,250,0.6);
          cursor: pointer;
        }
        .scrubber-range::-moz-range-thumb {
          width: 18px; height: 18px; border-radius: 50%;
          background: #a78bfa; border: none;
          box-shadow: 0 0 6px rgba(167,139,250,0.6);
        }
      `}</style>

      {/* ── 全螢幕容器 ── */}
      <div style={{
        position: 'fixed', top: 0, left: 0,
        width: '100%', height: '100%',
        background: '#000', zIndex: 9999,
        overflow: 'hidden',
        userSelect: 'none', WebkitUserSelect: 'none',
      }}>

        {/* ── 影片 ── */}
        {isReady ? (
          <video
            ref={videoRef}
            key={streamUrl}
            src={streamUrl}
            autoPlay
            playsInline
            preload="auto"
            x-webkit-airplay="allow"
            onCanPlay={() => videoRef.current?.play().catch(() => {})}
            onLoadedData={() => videoRef.current?.play().catch(() => {})}
            onEnded={handleEnded}
            onPlay={()  => setPaused(false)}
            onPause={() => setPaused(true)}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onContextMenu={e => e.preventDefault()}
            style={{
              position: 'absolute', top: 0, left: 0,
              width: '100%', height: '100%',
              objectFit: 'contain',
              transformOrigin: 'center center',
              transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
              transition: isPinching.current ? 'none' : 'transform 0.1s ease',
              WebkitTouchCallout: 'none',
            }}
          />
        ) : (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#52525b', fontSize:14 }}>
            載入中…
          </div>
        )}

        {/* ── 手勢捕捉層 ── */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ position:'absolute', inset:0, zIndex:10, touchAction:'none' }}
        />

        {/* ── 暫停圖示 ── */}
        {paused && !showScrubber && (
          <div style={{
            position:'absolute', top:'50%', left:'50%',
            transform:'translate(-50%,-50%)',
            pointerEvents:'none', zIndex:15,
          }}>
            <div style={{ background:'rgba(0,0,0,0.55)', borderRadius:'50%', width:68, height:68, display:'flex', alignItems:'center', justifyContent:'center' }}>
              <span style={{ fontSize:30, color:'#fff', marginLeft:5 }}>▶</span>
            </div>
          </div>
        )}

        {/* ── 2x 倍速提示 ── */}
        {speedHint && (
          <div style={{
            position:'absolute', top:'50%', left:'50%',
            transform:'translate(-50%,-50%)',
            background:'rgba(0,0,0,0.75)', color:'#facc15',
            padding:'8px 22px', borderRadius:28,
            fontSize:16, fontWeight:800, letterSpacing:1,
            pointerEvents:'none', zIndex:20,
            animation:'popIn 0.15s ease', whiteSpace:'nowrap',
          }}>
            ▶▶ 2x 倍速
          </div>
        )}

        {/* ── 頂部列 ── */}
        <div style={{
          position:'absolute', top:0, left:0, right:0, zIndex:20,
          background:'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, transparent 100%)',
          paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)',
          padding:'12px 16px 36px',
          display:'flex', alignItems:'center', gap:10,
        }}>
          <button
            onClick={() => router.back()}
            style={{ background:'none', border:'none', color:'#fff', fontSize:26, cursor:'pointer', padding:'2px 8px', lineHeight:1, flexShrink:0, zIndex:25, position:'relative' }}
          >←</button>
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ fontWeight:600, fontSize:14, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {title || '影片播放'}
            </p>
            {chatTitle && (
              <p style={{ fontSize:11, color:'rgba(255,255,255,0.55)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginTop:2 }}>
                {chatTitle}
              </p>
            )}
          </div>
          {posLabel && (
            <span style={{ fontSize:12, color:'rgba(255,255,255,0.45)', flexShrink:0 }}>{posLabel}</span>
          )}
          {castState !== 'unavailable' && (
            <button onClick={handleCast} style={{
              background:'none', border:'none', flexShrink:0, cursor:'pointer',
              color: castState === 'connected' ? '#a78bfa' : 'rgba(255,255,255,0.7)',
              fontSize:13, fontWeight:600, fontFamily:'inherit',
              display:'flex', alignItems:'center', gap:4, padding:'4px 6px',
              position:'relative', zIndex:25,
            }}>
              {castState === 'connecting' ? <><CastSpinner/>…</> : <>📺</>}
            </button>
          )}
        </div>

        {/* ── 進度列（輕按出現，3 秒後自動收起）── */}
        {showScrubber && (
          <div style={{
            position:'absolute', bottom: 0, left:0, right:0, zIndex:25,
            background:'linear-gradient(to top, rgba(0,0,0,0.85) 0%, transparent 100%)',
            paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)',
            padding:'40px 16px 20px',
            animation:'fadeUp 0.2s ease',
          }}>
            {/* 時間軸 */}
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
              <span style={{ color:'rgba(255,255,255,0.8)', fontSize:12, minWidth:40, textAlign:'right', fontVariantNumeric:'tabular-nums' }}>
                {fmtDuration(currentTime)}
              </span>
              <input
                type="range"
                className="scrubber-range"
                min={0}
                max={videoDuration || 100}
                step={0.5}
                value={currentTime}
                onChange={(e) => {
                  const t = parseFloat(e.target.value);
                  const vid = videoRef.current;
                  if (vid) vid.currentTime = t;
                  setCurrentTime(t);
                  showScrubberFor3s();
                }}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e)  => e.stopPropagation()}
                onTouchEnd={(e)   => e.stopPropagation()}
              />
              <span style={{ color:'rgba(255,255,255,0.8)', fontSize:12, minWidth:40, fontVariantNumeric:'tabular-nums' }}>
                {fmtDuration(videoDuration)}
              </span>
            </div>

            {/* 控制按鈕列 */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              {/* 左：頻道 + 標題 */}
              <div style={{ flex:1, minWidth:0, marginRight:12 }}>
                {chatTitle && (
                  <p style={{ fontSize:11, color:'#a78bfa', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:3 }}>
                    {chatTitle}
                  </p>
                )}
                <p style={{ fontSize:13, fontWeight:600, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {title || '影片'}
                </p>
                <div style={{ display:'flex', gap:12, marginTop:4 }}>
                  {parseInt(duration) > 0 && <span style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>⏱ {fmtDuration(parseInt(duration))}</span>}
                  {parseInt(fileSize) > 0 && <span style={{ fontSize:10, color:'rgba(255,255,255,0.4)' }}>💾 {fmtBytes(parseInt(fileSize))}</span>}
                </div>
              </div>

              {/* 右：播放 / 暫停 + 最愛 + 下一支 */}
              <div style={{ display:'flex', alignItems:'center', gap:16, flexShrink:0 }}>
                {hasPrev && (
                  <button onClick={() => { goPrev(); }} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:22, cursor:'pointer', padding:4 }}>⏮</button>
                )}
                <button
                  onClick={() => {
                    const vid = videoRef.current;
                    if (vid) { if (vid.paused) vid.play(); else vid.pause(); }
                    showScrubberFor3s();
                  }}
                  style={{ background:'none', border:'none', color:'#fff', fontSize:32, cursor:'pointer', padding:4, lineHeight:1 }}
                >
                  {paused ? '▶' : '⏸'}
                </button>
                {hasNext && (
                  <button onClick={() => { goNext(); }} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.6)', fontSize:22, cursor:'pointer', padding:4 }}>⏭</button>
                )}
                <button
                  onClick={() => {
                    if (!videoId) return;
                    const video = {
                      id: videoId, chatId, msgId, accessHash, chatType,
                      mimeType: mimeType||'video/mp4', accountId,
                      title: title||'', chatTitle: chatTitle||'',
                      date: parseInt(date)||0, duration: parseInt(duration)||0,
                      fileSize: parseInt(fileSize)||0, hasThumbnail: hasThumbnail==='true',
                    };
                    const added = toggleFavorite(video);
                    setFav(added);
                    showToast(added ? '❤️ 已加入最愛' : '🤍 已從最愛移除');
                    showScrubberFor3s();
                  }}
                  style={{ background:'none', border:'none', fontSize:26, cursor:'pointer', padding:4, lineHeight:1 }}
                >{fav ? '❤️' : '🤍'}</button>
              </div>
            </div>
          </div>
        )}

        {/* ── 底部列（scrubber 隱藏時顯示：最愛 + 切換）── */}
        {!showScrubber && (
          <div style={{
            position:'absolute', bottom:0, left:0, right:0, zIndex:20,
            background:'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
            paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)',
            padding:'32px 16px 20px',
            display:'flex', alignItems:'flex-end', gap:14,
            pointerEvents:'none',
          }}>
            <div style={{ flex:1 }}/>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14, flexShrink:0, pointerEvents:'auto' }}>
              <button
                onClick={() => {
                  if (!videoId) return;
                  const video = {
                    id: videoId, chatId, msgId, accessHash, chatType,
                    mimeType: mimeType||'video/mp4', accountId,
                    title: title||'', chatTitle: chatTitle||'',
                    date: parseInt(date)||0, duration: parseInt(duration)||0,
                    fileSize: parseInt(fileSize)||0, hasThumbnail: hasThumbnail==='true',
                  };
                  const added = toggleFavorite(video);
                  setFav(added);
                  showToast(added ? '❤️ 已加入最愛' : '🤍 已從最愛移除');
                }}
                style={{ background:'none', border:'none', fontSize:30, cursor:'pointer', padding:4, lineHeight:1 }}
              >{fav ? '❤️' : '🤍'}</button>
              {hasNext && (
                <button onClick={goNext} style={{ background:'rgba(255,255,255,0.18)', border:'none', borderRadius:20, color:'#fff', fontSize:11, fontWeight:700, cursor:'pointer', padding:'5px 14px', fontFamily:'inherit' }}>下一支 ↑</button>
              )}
              {hasPrev && (
                <button onClick={goPrev} style={{ background:'rgba(255,255,255,0.12)', border:'none', borderRadius:20, color:'rgba(255,255,255,0.6)', fontSize:11, fontWeight:600, cursor:'pointer', padding:'5px 14px', fontFamily:'inherit' }}>↓ 上一支</button>
              )}
            </div>
          </div>
        )}

        {/* ── Toast ── */}
        {toast && (
          <div style={{
            position:'absolute', bottom:130, left:'50%', transform:'translateX(-50%)',
            background:'rgba(0,0,0,0.82)', border:'1px solid rgba(255,255,255,0.12)',
            color:'#f4f4f5', padding:'10px 22px', borderRadius:24,
            fontSize:13, zIndex:30, whiteSpace:'nowrap', pointerEvents:'none',
          }}>
            {toast}
          </div>
        )}
      </div>
    </>
  );
}
