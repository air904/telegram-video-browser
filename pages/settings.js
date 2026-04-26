/**
 * /settings — 設定頁
 * 選擇 Telegram 文件夾（Folder）作為影片來源。
 * 文件夾清單第一次進入自動從 Telegram 抓取，後續使用快取。
 * 選取結果儲存在 cookie（tg_folder），首頁讀取後依此掃描。
 */
import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  getKnownFolders, saveKnownFolders,
  getSelectedFolderId, saveSelectedFolderId,
} from '../lib/storage';

function NavBar({ active }) {
  const items = [
    { href: '/', icon: '🏠', label: '首頁', key: 'home' },
    { href: '/favorites', icon: '❤️', label: '最愛', key: 'favorites' },
    { href: '/settings', icon: '⚙️', label: '設定', key: 'settings' },
  ];
  return (
    <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
      background: 'rgba(13,13,15,0.96)', backdropFilter: 'blur(14px)',
      borderTop: '1px solid #1f1f23', display: 'flex', height: 58 }}>
      {items.map(item => (
        <Link key={item.key} href={item.href}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 2,
            color: active === item.key ? '#a78bfa' : '#52525b',
            textDecoration: 'none', fontSize: 11, fontWeight: 600, transition: 'color 0.15s' }}>
          <span style={{ fontSize: 22 }}>{item.icon}</span>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function Spinner({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor"
        strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round" />
    </svg>
  );
}

// 文件夾 icon（依名稱或 id 決定）
function FolderIcon({ title }) {
  if (title === '所有聊天') return <>💬</>;
  const lower = (title || '').toLowerCase();
  if (lower.includes('work') || lower.includes('工作')) return <>💼</>;
  if (lower.includes('sport') || lower.includes('運動')) return <>🏃</>;
  if (lower.includes('news') || lower.includes('新聞')) return <>📰</>;
  if (lower.includes('music') || lower.includes('音樂')) return <>🎵</>;
  if (lower.includes('video') || lower.includes('影片')) return <>🎬</>;
  if (lower.includes('fam') || lower.includes('家人')) return <>👨‍👩‍👧</>;
  return <>📁</>;
}

export default function SettingsPage() {
  const [folders, setFolders]           = useState([]);
  const [selectedId, setSelectedId]     = useState(null); // null = 未選
  const [fetching, setFetching]         = useState(false);
  const [fetchError, setFetchError]     = useState('');
  const [saved, setSaved]               = useState(false);

  // 掛載：讀取快取；若無快取則自動蒐集
  useEffect(() => {
    const known = getKnownFolders();
    setFolders(known);
    setSelectedId(getSelectedFolderId());
    if (known.length === 0) fetchFolders(); // 第一次進入自動取得
  }, []); // eslint-disable-line

  async function fetchFolders() {
    setFetching(true);
    setFetchError('');
    try {
      const res  = await fetch('/api/folders', { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      saveKnownFolders(data.folders);
      setFolders(data.folders);
    } catch (e) {
      setFetchError(e.message || '取得失敗，請稍後再試');
    }
    setFetching(false);
  }

  function selectFolder(id) {
    setSelectedId(id);
    saveSelectedFolderId(id);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <>
      <Head>
        <title>設定 — Telegram 影片瀏覽器</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d0f; color: #f4f4f5;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          -webkit-font-smoothing: antialiased; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: #2e2e35; border-radius: 3px; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .row { animation: fadeIn 0.15s ease both; }
      `}</style>

      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(13,13,15,0.9)', backdropFilter: 'blur(14px)',
        borderBottom: '1px solid #1f1f23', display: 'flex', alignItems: 'center',
        padding: '0 16px', height: 56, gap: 12 }}>
        <Link href="/" style={{ color: '#a1a1aa', fontSize: 22, textDecoration: 'none', lineHeight: 1, flexShrink: 0 }}>←</Link>
        <h1 style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>設定</h1>
        {saved && <span style={{ fontSize: 12, color: '#a78bfa', flexShrink: 0 }}>✓ 已儲存</span>}
      </header>

      <main style={{ padding: '16px', paddingBottom: 80 }}>

        {/* ── 文件夾選擇 ── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>📂 選擇文件夾</h2>
            <p style={{ fontSize: 12, color: '#71717a', marginTop: 4, lineHeight: 1.5 }}>
              選取一個 Telegram 文件夾作為影片來源。<br/>
              首頁將掃描該文件夾內所有群組的影片。
            </p>
          </div>

          {/* 重新取得按鈕 */}
          <button
            onClick={fetchFolders}
            disabled={fetching}
            style={{ width: '100%', marginBottom: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '11px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: fetching ? '#1f1f23' : folders.length === 0 ? '#7c3aed' : '#18181b',
              color: fetching ? '#71717a' : folders.length === 0 ? '#fff' : '#a78bfa',
              border: folders.length === 0 ? '1px solid transparent' : '1px solid #3f3f46',
              cursor: fetching ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}>
            {fetching
              ? <><Spinner size={14} /> 取得中，請稍候…</>
              : folders.length === 0
                ? <>📂 取得帳號文件夾</>
                : <>🔄 重新取得文件夾（共 {folders.length} 個）</>
            }
          </button>

          {/* 錯誤提示 */}
          {fetchError && (
            <div style={{ background: '#ef444422', border: '1px solid #ef444455',
              borderRadius: 8, padding: '10px 14px', color: '#fca5a5',
              fontSize: 12, marginBottom: 14 }}>
              ⚠️ {fetchError}
            </div>
          )}

          {/* 空狀態 */}
          {!fetching && folders.length === 0 && !fetchError && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#52525b',
              background: '#111113', borderRadius: 12, border: '1px solid #1f1f23' }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📭</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#3f3f46' }}>尚無文件夾資料</p>
              <p style={{ fontSize: 12, marginTop: 6 }}>點擊上方按鈕取得帳號文件夾</p>
            </div>
          )}

          {/* 文件夾清單（radio 選擇） */}
          {folders.length > 0 && (
            <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #1f1f23' }}>
              {folders.map((folder, i) => {
                const isSelected = selectedId === folder.id;
                return (
                  <div key={folder.id} className="row"
                    onClick={() => selectFolder(folder.id)}
                    style={{ animationDelay: `${Math.min(i * 0.04, 0.4)}s`,
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '14px 16px',
                      background: isSelected ? '#1c1528' : '#111113',
                      borderBottom: i < folders.length - 1 ? '1px solid #1f1f23' : 'none',
                      cursor: 'pointer', transition: 'background 0.15s',
                      borderLeft: isSelected ? '3px solid #7c3aed' : '3px solid transparent' }}>

                    {/* Radio indicator */}
                    <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${isSelected ? '#7c3aed' : '#3f3f46'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s' }}>
                      {isSelected && <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#7c3aed' }}/>}
                    </div>

                    {/* Icon */}
                    <span style={{ fontSize: 22, flexShrink: 0 }}>
                      <FolderIcon title={folder.title} />
                    </span>

                    {/* Name */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, fontSize: 15,
                        color: isSelected ? '#c4b5fd' : '#d4d4d8',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        transition: 'color 0.15s' }}>
                        {folder.title}
                      </p>
                      {folder.id === 0 && (
                        <p style={{ fontSize: 11, color: '#52525b', marginTop: 2 }}>掃描所有群組與頻道</p>
                      )}
                    </div>

                    {isSelected && (
                      <span style={{ fontSize: 18, color: '#7c3aed', flexShrink: 0 }}>✓</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 選取說明 */}
          {selectedId !== null && (
            <p style={{ fontSize: 11, color: '#52525b', marginTop: 10, textAlign: 'center' }}>
              已選：<span style={{ color: '#a78bfa' }}>
                {folders.find(f => f.id === selectedId)?.title || `文件夾 ${selectedId}`}
              </span>
              　→　返回首頁後將自動重新掃描
            </p>
          )}
        </div>

        {/* ── 關於 ── */}
        <div style={{ borderRadius: 12, background: '#111113', border: '1px solid #1f1f23',
          padding: '16px', textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: '#52525b' }}>Telegram 影片瀏覽器</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: '#3f3f46', marginTop: 4 }}>v1.2</p>
        </div>
      </main>

      <NavBar active="settings" />
    </>
  );
}
