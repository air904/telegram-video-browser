/**
 * /video — 影片全螢幕播放頁面 v3
 *
 * 手勢規則（全螢幕）：
 *   上滑 (≥ 60px) → 下一支
 *   下滑 (≥ 60px) → 上一支
 *   長按上 1/3 螢幕 500ms  → 加入 / 取消最愛
 *   長按上 1/3 螢幕 3000ms → 下載影片
 *   長按下 2/3 螢幕 500ms  → 2x 倍速（放開恢復）
 *   單擊                   → 播放 / 暫停切換
 */
import { useRouter } from 'next/router';
import { useEffect, useState, useRef, useCallback } from 'react';
import Head from 'next/head';
import { addWatched, isFavorite, toggleFavorite, getPlaylist } from '../lib/storage';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDuration(secs) {
  if (!secs) return '';
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
      style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}>
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

  // ── State ────────────────────────────────────────────────────────────────────
  const [fav,          setFav]          = useState(false);
  const [toast,        setToast]        = useState('');
  const [playlist,     setPlaylist]     = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [speedHint,    setSpeedHint]    = useState(false);  // 2x overlay
  const [paused,       setPaused]       = useState(false);  // 暫停圖示
  const [castState,    setCastState]    = useState('unavailable');

  // ── Refs ─────────────────────────────────────────────────────────────────────
  const videoRef         = useRef(null);
  const navigating       = useRef(false);
  const toastTimer       = useRef(null);
  const touchStartY      = useRef(null);
  const touchStartX      = useRef(null);
  const touchStartTime   = useRef(null);
  const lpTopTimer       = useRef(null);   // 上 1/3：500ms → 最愛
  const lpTopDlTimer     = useRef(null);   // 上 1/3：3000ms → 下載
  const lpBotTimer       = useRef(null);   // 下 2/3：500ms → 2x
  const is2xMode         = useRef(false);
  const lpFired          = useRef(false);  // 已觸發長按，抑制單擊

  // ── Stream URL（在所有 hooks 前）────────────────────────────────────────────
  const videoId  = chatId && msgId ? `${chatId}_${msgId}` : null;
  const streamUrl = chatId
    ? `/api/stream?chatId=${chatId}&msgId=${msgId}` +
      `&accessHash=${encodeURIComponent(accessHash||'')}` +
      `&chatType=${chatType}&mimeType=${encodeURIComponent(mimeType||'video/mp4')}` +
      `&accountId=${accountId}&fileSize=${fileSize||0}` +
      `&docId=${encodeURIComponent(docId||'')}` +
      `&docAccessHash=${encodeURIComponent(docAccessHash||'')}` +
      `&docFileRef=${encodeURIComponent(docFileRef||'')}`
    : '';

  // ── Load playlist ─────────────────────────────────────────────────────────
  useEffect(() => { setPlaylist(getPlaylist()); }, []);

  // ── currentIndex ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!videoId || !playlist.length) return;
    setCurrentIndex(playlist.findIndex(v => v.id === videoId));
  }, [videoId, playlist]);

  // ── Mark watched + fav ───────────────────────────────────────────────────
  useEffect(() => {
    if (!chatId || !msgId || !accountId) return;
    addWatched({
      id: videoId, chatId, msgId, accessHash, chatType,
      mimeType: mimeType || 'video/mp4', accountId,
      title: title || '', chatTitle: chatTitle || '',
      date: parseInt(date)||0, duration: parseInt(duration)||0,
      fileSize: parseInt(fileSize)||0, hasThumbnail: hasThumbnail === 'true',
    });
    setFav(isFavorite(videoId));
    navigating.current = false;
  }, [chatId, msgId, accountId]); // eslint-disable-line

  // ── Cast 偵測 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.remote) {
      vid.remote.watchAvailability(ok => {
        if (ok) setCastState(s => s === 'connected' ? s : 'available');
      }).catch(()=>{});
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

  // ── Helpers ───────────────────────────────────────────────────────────────
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
    } else {
      showToast('播放清單已結束');
    }
  }, [currentIndex, playlist, goNext, showToast]);

  const handleCast = useCallback(async () => {
    const vid = videoRef.current; if (!vid) return;
    if (vid.remote) { try { await vid.remote.requestRemotePlayback(); return; } catch {} }
    if (vid.webkitShowPlaybackTargetPicker) vid.webkitShowPlaybackTargetPicker();
  }, []);

  // ── 觸控手勢 ─────────────────────────────────────────────────────────────
  const handleTouchStart = useCallback((e) => {
    const touch = e.touches[0];
    touchStartY.current    = touch.clientY;
    touchStartX.current    = touch.clientX;
    touchStartTime.current = Date.now();
    lpFired.current        = false;
    clearAllLpTimers();

    // 上 1/3 vs 下 2/3：以螢幕高度判斷
    const isTopZone = touch.clientY < window.innerHeight / 3;

    if (isTopZone) {
      // ── 上 1/3：500ms → 最愛；3000ms → 下載 ────────────────────────────
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
      // ── 下 2/3：500ms → 2x 倍速 ─────────────────────────────────────────
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
    if (touchStartY.current === null) return;
    const absY = Math.abs(e.touches[0].clientY - touchStartY.current);
    const absX = Math.abs(e.touches[0].clientX - touchStartX.current);
    // 移動超過 15px → 取消所有長按計時（不觸發最愛 / 下載 / 2x）
    if (absY > 15 || absX > 15) clearAllLpTimers();
  }, [clearAllLpTimers]);

  const handleTouchEnd = useCallback((e) => {
    clearAllLpTimers();

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
    const end    = e.changedTouches[0];
    const deltaY = touchStartY.current  - end.clientY;  // > 0 = 上滑
    const deltaX = touchStartX.current  - end.clientX;
    const absY   = Math.abs(deltaY);
    const absX   = Math.abs(deltaX);
    const elapsed = Date.now() - (touchStartTime.current || 0);
    touchStartY.current = null;

    // ── 垂直滑動 ≥ 60px 且垂直幅度 > 水平 → 切換影片 ───────────────────
    if (absY >= 60 && absY > absX * 1.5) {
      if (deltaY > 0) goNext(); // 上滑 → 下一支
      else            goPrev(); // 下滑 → 上一支
      return;
    }

    // ── 單擊（< 250ms，移動 < 15px，未觸發長按）→ 播放 / 暫停切換 ────────
    if (!lpFired.current && elapsed < 250 && absX < 15 && absY < 15) {
      const vid = videoRef.current;
      if (vid) {
        if (vid.paused) vid.play();
        else            vid.pause();
      }
    }
  }, [goNext, goPrev, clearAllLpTimers]);

  // ── Derived ──────────────────────────────────────────────────────────────
  const isReady  = !!chatId;
  const hasPrev  = currentIndex > 0;
  const hasNext  = currentIndex >= 0 && currentIndex < playlist.length - 1;
  const posLabel = currentIndex >= 0 && playlist.length > 1
    ? `${currentIndex + 1} / ${playlist.length}` : '';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>{title || '影片播放'} — Telegram 影片瀏覽器</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
      </Head>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #000; overflow: hidden; }
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes popIn   { from { opacity:0; transform:translate(-50%,-50%) scale(0.85); } to { opacity:1; transform:translate(-50%,-50%) scale(1); } }
        @keyframes fadeIn  { from { opacity:0; } to { opacity:1; } }
      `}</style>

      {/* ── 全螢幕容器（CSS fixed，不依賴 requestFullscreen）── */}
      <div style={{
        position: 'fixed', inset: 0, background: '#000', zIndex: 9999,
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
            onEnded={handleEnded}
            onPlay={()  => setPaused(false)}
            onPause={() => setPaused(true)}
            onContextMenu={e => e.preventDefault()}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'contain',
              WebkitTouchCallout: 'none',
            }}
          />
        ) : (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', color:'#52525b', fontSize:14 }}>
            載入中…
          </div>
        )}

        {/* ── 手勢捕捉層（透明，z-index 低於頂 / 底列按鈕）── */}
        <div
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{ position:'absolute', inset:0, zIndex:10 }}
        />

        {/* ── 暫停圖示 ── */}
        {paused && (
          <div style={{
            position:'absolute', top:'50%', left:'50%',
            transform:'translate(-50%,-50%)',
            pointerEvents:'none', zIndex:15, animation:'fadeIn 0.15s ease',
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

        {/* ── 頂部列（← 返回 / 標題 / 播放順序 / 投影）── */}
        <div style={{
          position:'absolute', top:0, left:0, right:0, zIndex:20,
          background:'linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, transparent 100%)',
          padding:'env(safe-area-inset-top, 12px) 16px 32px',
          paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)',
          display:'flex', alignItems:'center', gap:10,
        }}>
          <button
            onClick={() => router.back()}
            style={{ background:'none', border:'none', color:'#fff', fontSize:26, cursor:'pointer', padding:'2px 8px', lineHeight:1, flexShrink:0 }}
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
            }}>
              {castState === 'connecting' ? <><CastSpinner/>…</> : <>📺</>}
            </button>
          )}
        </div>

        {/* ── 底部列（頻道 / 標題 / 時長 ／ ❤️ / 下一支）── */}
        <div style={{
          position:'absolute', bottom:0, left:0, right:0, zIndex:20,
          background:'linear-gradient(to top, rgba(0,0,0,0.78) 0%, transparent 100%)',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)',
          padding:'32px 16px',
          paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 20px)',
          display:'flex', alignItems:'flex-end', gap:14,
        }}>
          <div style={{ flex:1, minWidth:0 }}>
            {chatTitle && (
              <p style={{ fontSize:12, color:'#a78bfa', marginBottom:5, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                📡 {chatTitle}
              </p>
            )}
            <p style={{ fontSize:15, fontWeight:600, color:'#fff', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
              {title || '影片'}
            </p>
            <div style={{ display:'flex', gap:14, marginTop:5 }}>
              {parseInt(duration) > 0 && <span style={{ fontSize:11, color:'rgba(255,255,255,0.45)' }}>⏱ {fmtDuration(parseInt(duration))}</span>}
              {parseInt(fileSize) > 0 && <span style={{ fontSize:11, color:'rgba(255,255,255,0.45)' }}>💾 {fmtBytes(parseInt(fileSize))}</span>}
            </div>
          </div>

          {/* 右側按鈕群 */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:14, flexShrink:0 }}>
            {/* 最愛按鈕 */}
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
              style={{ background:'none', border:'none', fontSize:30, cursor:'pointer', padding:4, lineHeight:1, transform: fav ? 'scale(1.2)':'scale(1)', transition:'transform 0.15s' }}
            >{fav ? '❤️' : '🤍'}</button>

            {/* 下一支按鈕（有下一支才顯示）*/}
            {hasNext && (
              <button onClick={goNext} style={{
                background:'rgba(255,255,255,0.18)', border:'none',
                borderRadius:20, color:'#fff', fontSize:11, fontWeight:700,
                cursor:'pointer', padding:'5px 14px', fontFamily:'inherit',
              }}>下一支 ↑</button>
            )}

            {/* 上一支按鈕（有上一支才顯示）*/}
            {hasPrev && (
              <button onClick={goPrev} style={{
                background:'rgba(255,255,255,0.12)', border:'none',
                borderRadius:20, color:'rgba(255,255,255,0.6)', fontSize:11, fontWeight:600,
                cursor:'pointer', padding:'5px 14px', fontFamily:'inherit',
              }}>↓ 上一支</button>
            )}
          </div>
        </div>

        {/* ── Toast ── */}
        {toast && (
          <div style={{
            position:'absolute', bottom:110, left:'50%', transform:'translateX(-50%)',
            background:'rgba(0,0,0,0.82)', border:'1px solid rgba(255,255,255,0.12)',
            color:'#f4f4f5', padding:'10px 22px', borderRadius:24,
            fontSize:13, zIndex:30, whiteSpace:'nowrap', pointerEvents:'none',
            boxShadow:'0 4px 16px rgba(0,0,0,0.5)',
          }}>
            {toast}
          </div>
        )}
      </div>
    </>
  );
}
