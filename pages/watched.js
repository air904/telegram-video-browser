/**
 * /watched — 已瀏覽頁面
 * 顯示所有看過的影片（最新在前）。
 * 可單筆移除或清空全部。
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { getWatched, removeWatched, clearWatched } from '../lib/storage';

function fmtDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
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

function WatchedCard({ video, onPlay, onRemove }) {
  const [hover, setHover] = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const thumbSrc = `/api/thumb?chatId=${video.chatId}&msgId=${video.msgId}&accessHash=${video.accessHash}&chatType=${video.chatType}&accountId=${video.accountId}`;

  return (
    <div
      style={{ background: hover ? '#27272b' : '#1f1f23', borderRadius: 12, overflow: 'hidden', border: '1px solid #2e2e35', position: 'relative', transition: 'all 0.15s', transform: hover ? 'translateY(-2px)' : 'none', boxShadow: hover ? '0 8px 24px rgba(0,0,0,0.4)' : 'none' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {/* Remove button */}
      <button
        onClick={(e) => { e.stopPropagation(); onRemove(video.id); }}
        style={{ position: 'absolute', top: 8, left: 8, zIndex: 10, width: 28, height: 28, borderRadius: '50%', background: 'rgba(39,39,43,0.9)', color: '#71717a', fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #3f3f46', lineHeight: 1, transition: 'all 0.15s' }}
        title="從歷史移除"
      >×</button>

      {/* Thumbnail */}
      <div onClick={() => onPlay(video)} style={{ cursor: 'pointer', position: 'relative', aspectRatio: '16/9', background: '#111113', overflow: 'hidden' }}>
        {video.hasThumbnail && !imgErr ? (
          <img src={thumbSrc} alt="" onError={() => setImgErr(true)} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, opacity: 0.25 }}>🎬</div>
        )}
        {/* Watched overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: hover ? 'rgba(124,58,237,0.9)' : 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, transition: 'background 0.15s' }}>▶</div>
        </div>
        {video.duration > 0 && (
          <div style={{ position: 'absolute', bottom: 6, right: 6, background: 'rgba(0,0,0,0.75)', color: '#fff', borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 600 }}>{fmtDuration(video.duration)}</div>
        )}
        {/* Watched badge */}
        <div style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.65)', color: '#a1a1aa', borderRadius: 4, padding: '2px 6px', fontSize: 10 }}>👁 已看</div>
      </div>

      {/* Meta */}
      <div onClick={() => onPlay(video)} style={{ padding: '10px 12px', cursor: 'pointer' }}>
        <p style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginBottom: 4, color: '#d4d4d8' }}>{video.title || '影片'}</p>
        <p style={{ fontSize: 11, color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{video.chatTitle}</p>
        {video.watchedAt && <p style={{ fontSize: 10, color: '#3f3f46', marginTop: 3 }}>觀看時間：{fmtDateTime(video.watchedAt)}</p>}
      </div>
    </div>
  );
}

export default function WatchedPage() {
  const router = useRouter();
  const [watched, setWatched] = useState([]);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => { setWatched(getWatched()); }, []);

  function handlePlay(video) {
    const p = new URLSearchParams({
      chatId: video.chatId, msgId: video.msgId,
      accessHash: video.accessHash || '', chatType: video.chatType || '',
      mimeType: video.mimeType || 'video/mp4', accountId: video.accountId || '',
      title: video.title || '', chatTitle: video.chatTitle || '',
      date: video.date || 0, duration: video.duration || 0,
      fileSize: video.fileSize || 0, hasThumbnail: video.hasThumbnail ? 'true' : 'false',
    });
    router.push(`/video?${p}`);
  }

  function handleRemove(videoId) {
    removeWatched(videoId);
    setWatched((prev) => prev.filter((v) => v.id !== videoId));
  }

  function handleClearAll() {
    clearWatched();
    setWatched([]);
    setShowConfirm(false);
  }

  return (
    <>
      <Head>
        <title>已瀏覽 — Telegram 影片瀏覽器</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d0f; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
        .wcard { animation: fadeIn 0.2s ease both; }
        .wgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
        @media (max-width: 480px) { .wgrid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; } }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: #2e2e35; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(13,13,15,0.9)', backdropFilter: 'blur(14px)', borderBottom: '1px solid #1f1f23', display: 'flex', alignItems: 'center', padding: '0 16px', height: 56, gap: 12 }}>
        <span style={{ fontSize: 22 }}>👁</span>
        <h1 style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>已瀏覽</h1>
        <span style={{ color: '#71717a', fontSize: 13, marginRight: 8 }}>{watched.length} 支</span>
        {watched.length > 0 && (
          <button
            onClick={() => setShowConfirm(true)}
            style={{ background: '#ef444422', color: '#ef4444', border: '1px solid #ef444455', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}
          >
            清空
          </button>
        )}
      </header>

      <main style={{ padding: 16, paddingBottom: 80, minHeight: 'calc(100vh - 56px)' }}>
        {watched.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '100px 20px', color: '#52525b' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>👀</div>
            <p style={{ fontSize: 18, fontWeight: 600, color: '#3f3f46' }}>還沒有瀏覽紀錄</p>
            <p style={{ marginTop: 8, fontSize: 13 }}>播放過的影片會自動記錄在這裡</p>
            <Link href="/" style={{ display: 'inline-block', marginTop: 24, padding: '10px 24px', background: '#7c3aed', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>回首頁瀏覽</Link>
          </div>
        ) : (
          <div className="wgrid">
            {watched.map((v, i) => (
              <div key={v.id} className="wcard" style={{ animationDelay: `${Math.min(i * 0.025, 0.4)}s` }}>
                <WatchedCard video={v} onPlay={handlePlay} onRemove={handleRemove} />
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Clear confirm modal */}
      {showConfirm && (
        <div onClick={() => setShowConfirm(false)} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#18181b', borderRadius: 16, padding: 28, maxWidth: 320, width: '100%', border: '1px solid #27272b', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🗑️</div>
            <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>清空所有紀錄？</p>
            <p style={{ color: '#71717a', fontSize: 13, marginBottom: 24 }}>將移除全部 {watched.length} 筆瀏覽紀錄，且無法復原。</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowConfirm(false)} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'transparent', color: '#a1a1aa', border: '1px solid #2e2e35', cursor: 'pointer', fontWeight: 600 }}>取消</button>
              <button onClick={handleClearAll} style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#ef4444', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>確認清空</button>
            </div>
          </div>
        </div>
      )}

      <NavBar active="watched" />
    </>
  );
}
