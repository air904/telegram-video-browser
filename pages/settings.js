/**
 * /settings — 設定頁
 * 選擇首頁要顯示哪些群組的影片，自動儲存至 localStorage。
 */
import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { getKnownGroups, getSelectedGroupIds, saveSelectedGroupIds } from '../lib/storage';

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

export default function SettingsPage() {
  const [groups, setGroups] = useState([]);
  const [selectedIds, setSelectedIds] = useState(null); // null = 全部
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef(null);

  useEffect(() => {
    setGroups(getKnownGroups());
    setSelectedIds(getSelectedGroupIds());
  }, []);

  // 顯示「已儲存」提示
  function flashSaved() {
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1500);
  }

  function toggle(chatId) {
    let next;
    if (selectedIds === null) {
      // 目前全選 → 取消這個群組
      next = groups.map(g => g.chatId).filter(id => id !== chatId);
    } else if (selectedIds.includes(chatId)) {
      // 取消選取
      next = selectedIds.filter(id => id !== chatId);
      if (next.length === 0) next = []; // 允許全不選
    } else {
      // 選取
      next = [...selectedIds, chatId];
      if (next.length === groups.length) next = null; // 全選 → 回 null
    }
    setSelectedIds(next);
    saveSelectedGroupIds(next);
    flashSaved();
  }

  function selectAll() {
    setSelectedIds(null);
    saveSelectedGroupIds(null);
    flashSaved();
  }

  function deselectAll() {
    setSelectedIds([]);
    saveSelectedGroupIds([]);
    flashSaved();
  }

  function isSelected(chatId) {
    return selectedIds === null || selectedIds.includes(chatId);
  }

  const selectedCount = selectedIds === null ? groups.length : selectedIds.length;

  return (
    <>
      <Head>
        <title>設定 — Telegram 影片瀏覽器</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0d0d0f; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; -webkit-font-smoothing: antialiased; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: #2e2e35; border-radius: 3px; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
        .row { animation: fadeIn 0.18s ease both; }
      `}</style>

      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50, background: 'rgba(13,13,15,0.9)', backdropFilter: 'blur(14px)', borderBottom: '1px solid #1f1f23', display: 'flex', alignItems: 'center', padding: '0 16px', height: 56, gap: 12 }}>
        <Link href="/" style={{ color: '#a1a1aa', fontSize: 22, textDecoration: 'none', lineHeight: 1, flexShrink: 0 }}>←</Link>
        <h1 style={{ fontSize: 17, fontWeight: 700, flex: 1 }}>設定</h1>
        {saved && <span style={{ fontSize: 12, color: '#a78bfa' }}>✓ 已儲存</span>}
      </header>

      <main style={{ padding: '16px', paddingBottom: 80 }}>

        {/* Section: Group Filter */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: 15, fontWeight: 700 }}>📡 群組篩選</h2>
              <p style={{ fontSize: 12, color: '#71717a', marginTop: 2 }}>
                選擇首頁要顯示哪些群組的影片
                {groups.length > 0 && ` · 已選 ${selectedCount} / ${groups.length} 個`}
              </p>
            </div>
            <button
              onClick={selectAll}
              style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: selectedIds === null ? '#7c3aed22' : '#18181b', color: selectedIds === null ? '#a78bfa' : '#71717a', border: `1px solid ${selectedIds === null ? '#7c3aed' : '#2e2e35'}`, cursor: 'pointer', transition: 'all 0.15s' }}
            >全選</button>
            <button
              onClick={deselectAll}
              style={{ padding: '5px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#18181b', color: '#71717a', border: '1px solid #2e2e35', cursor: 'pointer' }}
            >全不選</button>
          </div>

          {groups.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 20px', color: '#52525b' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: '#3f3f46' }}>尚無群組資料</p>
              <p style={{ fontSize: 12, marginTop: 6 }}>請先回首頁掃描一次影片</p>
              <Link href="/" style={{ display: 'inline-block', marginTop: 16, padding: '8px 20px', background: '#7c3aed', color: '#fff', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                前往首頁掃描
              </Link>
            </div>
          ) : (
            <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #1f1f23' }}>
              {groups.map((g, i) => {
                const checked = isSelected(g.chatId);
                return (
                  <div
                    key={g.chatId}
                    className="row"
                    onClick={() => toggle(g.chatId)}
                    style={{
                      animationDelay: `${i * 0.02}s`,
                      display: 'flex', alignItems: 'center', gap: 14,
                      padding: '13px 16px',
                      background: checked ? '#1a1a1f' : '#111113',
                      borderBottom: i < groups.length - 1 ? '1px solid #1f1f23' : 'none',
                      cursor: 'pointer',
                      transition: 'background 0.15s',
                    }}
                  >
                    {/* Checkbox */}
                    <div style={{
                      width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                      background: checked ? '#7c3aed' : 'transparent',
                      border: `2px solid ${checked ? '#7c3aed' : '#3f3f46'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {checked && <span style={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>✓</span>}
                    </div>

                    {/* Group info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 600, fontSize: 14, color: checked ? '#f4f4f5' : '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', transition: 'color 0.15s' }}>
                        {g.chatTitle || g.chatId}
                      </p>
                    </div>

                    {/* Video count */}
                    <span style={{ fontSize: 12, color: '#52525b', flexShrink: 0 }}>
                      {g.count} 支
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Section: About */}
        <div style={{ borderRadius: 12, background: '#111113', border: '1px solid #1f1f23', padding: '16px', textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: '#52525b' }}>Telegram 影片瀏覽器</p>
          <p style={{ fontSize: 20, fontWeight: 700, color: '#3f3f46', marginTop: 4 }}>v1.0</p>
        </div>
      </main>

      <NavBar active="settings" />
    </>
  );
}

