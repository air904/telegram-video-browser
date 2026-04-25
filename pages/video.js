/**
 * /video — 影片播放頁面
 * 透過 URL query 接收影片資訊，直接線上串流播放。
 * 點擊瀏覽器返回鍵回到上一頁。
 */
import { useRouter } from 'next/router';
import { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { addWatched, isFavorite, toggleFavorite } from '../lib/storage';

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
    { href: '/watched', icon: '👁', label: '已瀏覽', key: 'watched' },
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
  const { chatId, msgId, accessHash, chatType, mimeType, accountId, title, chatTitle, date, duration, fileSize, hasThumbnail } = router.query;
  const [fav, setFav] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);
  const videoId = chatId && msgId ? `${chatId}_${msgId}` : null;

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
  }, [chatId, msgId, accountId]);

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2000);
  };

  const handleFav = () => {
    if (!videoId) return;
    const video = { id: videoId, chatId, msgId, accessHash, chatType, mimeType: mimeType || 'video/mp4', accountId, title: title || '', chatTitle: chatTitle || '', date: parseInt(date) || 0, duration: parseInt(duration) || 0, fileSize: parseInt(fileSize) || 0, hasThumbnail: hasThumbnail === 'true' };
    const added = toggleFavorite(video);
    setFav(added);
    showToast(added ? '❤️ 已加入最愛' : '🤍 已從最愛移除');
  };

  const streamUrl = chatId
    ? `/api/stream?chatId=${chatId}&msgId=${msgId}&accessHash=${encodeURIComponent(accessHash||'')}&chatType=${chatType}&mimeType=${encodeURIComponent(mimeType||'video/mp4')}&accountId=${accountId}`
    : '';

  const isReady = !!chatId;

  return (
    <>
      <Head>
        <title>{title || '影片播放'} — Telegram 影片瀏覽器</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d0f; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: #2e2e35; border-radius: 3px; }
      `}</style>

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
        <button
          onClick={handleFav}
          title={fav ? '從最愛移除' : '加入最愛'}
          style={{ background: 'none', fontSize: 24, cursor: 'pointer', padding: 6, lineHeight: 1, flexShrink: 0, transition: 'transform 0.15s', transform: fav ? 'scale(1.2)' : 'scale(1)' }}
        >
          {fav ? '❤️' : '🤍'}
        </button>
      </header>

      {/* Video player */}
      <div style={{ background: '#000' }}>
        {isReady ? (
          <video
            key={streamUrl}
            src={streamUrl}
            controls
            autoPlay
            playsInline
            style={{ width: '100%', maxHeight: '75vh', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', aspectRatio: '16/9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#52525b', fontSize: 14 }}>
            載入中…
          </div>
        )}
      </div>

      {/* Info panel */}
      <div style={{ padding: '16px', paddingBottom: 80 }}>
        <h1 style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.4, marginBottom: 10 }}>{title || '影片'}</h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', marginBottom: 16 }}>
          {chatTitle && <span style={{ color: '#a78bfa', fontSize: 13 }}>📡 {chatTitle}</span>}
          {date && <span style={{ color: '#71717a', fontSize: 13 }}>📅 {fmtDate(parseInt(date))}</span>}
          {duration > 0 && <span style={{ color: '#71717a', fontSize: 13 }}>⏱ {fmtDuration(parseInt(duration))}</span>}
          {fileSize > 0 && <span style={{ color: '#71717a', fontSize: 13 }}>💾 {fmtBytes(parseInt(fileSize))}</span>}
        </div>

        {/* Favorite button (large) */}
        <button onClick={handleFav} style={{
          width: '100%', padding: '12px', borderRadius: 12, fontSize: 15, fontWeight: 600, cursor: 'pointer',
          background: fav ? '#7c3aed22' : '#18181b',
          border: `1px solid ${fav ? '#7c3aed' : '#2e2e35'}`,
          color: fav ? '#a78bfa' : '#71717a',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          transition: 'all 0.2s',
        }}>
          {fav ? '❤️ 已加入最愛' : '🤍 加入最愛'}
        </button>
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
