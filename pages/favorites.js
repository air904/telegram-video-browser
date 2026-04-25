/**
 * /favorites — 我的最愛頁面
 * 顯示所有長按加入的影片，點擊播放，× 移除。
 */
import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { getFavorites, removeFavorite } from '../lib/storage';

function fmtDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtDate(unix) {
  if (!unix) return '';
  return new Date(unix * 1000).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric', year: 'numeric' });
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

function FavCard({ video, onPlay, onRemove }) {
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
        style={{ position: 'absolute', top: 8, left: 8, zIndex: 10, width: 28, height: 28, borderRadius: '50%', background: 'rgba(239,68,68,0.85)', color: '#fff', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', lineHeight: 1, transition: 'transform 0.15s' }}
        title="從最愛移除"
      >×</button>

      {/* Thumbnail */}
      <div onClick={() => onPlay(video)} style={{ cursor: 'pointer', position: 'relative', aspectRatio: '16/9', background: '#111113', overflow: 'hidden' }}>
        {video.hasThumbnail && !imgErr ? (
          <img src={thumbSrc} alt="" onError={() => setImgErr(true)} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, opacity: 0.25 }}>🎬</div>
        )}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)', opacity: hover ? 1 : 0, transition: 'opacity 0.15s' }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'rgba(124,58,237,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>▶</div>
        </div>
        {video.duration > 0 && (
          <div style={{ position: 'absolute', bottom: 6, right: 6, background: 'rgba(0,0,0,0.75)', color: '#fff', borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 600 }}>{fmtDuration(video.duration)}</div>
        )}
        {/* Heart indicator */}
        <div style={{ position: 'absolute', top: 8, right: 8, fontSize: 16 }}>❤️</div>
      </div>

      {/* Meta */}
      <div onClick={() => onPlay(video)} style={{ padding: '10px 12px', cursor: 'pointer' }}>
        <p style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginBottom: 4, color: '#f4f4f5' }}>{video.title || '影片'}</p>
        <p style={{ fontSize: 11, color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{video.chatTitle}</p>
        <p style={{ fontSize: 11, color: '#52525b', marginTop: 3 }}>{fmtDate(video.date)}</p>
      </div>
    </div>
  );
}

export default function FavoritesPage() {
  const router = useRouter();
  const [favorites, setFavorites] = useState([]);

  useEffect(() => {
    setFavorites(getFavorites());
  }, []);

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
    removeFavorite(videoId);
    setFavorites((prev) => prev.filter((v) => v.id !== videoId));
  }

  return (
    <>
      <Head>
        <title>我的最愛 — Telegram 影片瀏覽器</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d0f; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }
        .fcard { animation: fadeIn 0.2s ease both; }
        .fgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
        @media (max-width: 480px) { .fgrid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; } }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: #2e2e35; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(13,13,15,0.9)', backdropFilter: 'blur(14px)', borderBottom: '1px solid #1f1f23', display: 'flex', alignItems: 'center', padding: '0 16px', height: 56, gap: 12 }}>
        <span style={{ fontSize: 22 }}>❤️</span>
        <h1 style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>我的最愛</h1>
        <span style={{ color: '#71717a', fontSize: 13 }}>{favorites.length} 支影片</span>
      </header>

      <main style={{ padding: 16, paddingBottom: 80, minHeight: 'calc(100vh - 56px)' }}>
        {favorites.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '100px 20px', color: '#52525b' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🤍</div>
            <p style={{ fontSize: 18, fontWeight: 600, color: '#3f3f46' }}>還沒有最愛的影片</p>
            <p style={{ marginTop: 8, fontSize: 13 }}>在首頁長按影片卡片即可加入最愛</p>
            <Link href="/" style={{ display: 'inline-block', marginTop: 24, padding: '10px 24px', background: '#7c3aed', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>回首頁瀏覽</Link>
          </div>
        ) : (
          <div className="fgrid">
            {favorites.map((v, i) => (
              <div key={v.id} className="fcard" style={{ animationDelay: `${Math.min(i * 0.025, 0.4)}s` }}>
                <FavCard video={v} onPlay={handlePlay} onRemove={handleRemove} />
              </div>
            ))}
          </div>
        )}
      </main>

      <NavBar active="favorites" />
    </>
  );
}
