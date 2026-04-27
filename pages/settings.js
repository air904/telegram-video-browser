/**
 * /settings — 設定頁 v2.2
 * ・每個帳號各自獨立儲存群組設定（per-account storage）
 * ・切換帳號後回到設定頁自動讀取對應帳號的設定
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  getKnownFolders, saveKnownFolders,
  saveSelectedFolderId,
  getFolderGroups, saveFolderGroups,
  getSelectedGroupsInFolder, saveSelectedGroupsInFolder,
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
            textDecoration: 'none', fontSize: 11, fontWeight: 600 }}>
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

function CheckBox({ checked, indeterminate }) {
  return (
    <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0,
      border: `2px solid ${checked || indeterminate ? '#7c3aed' : '#3f3f46'}`,
      background: checked ? '#7c3aed' : indeterminate ? '#7c3aed44' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.15s' }}>
      {checked && <span style={{ color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: 1 }}>✓</span>}
      {indeterminate && !checked && <span style={{ color: '#a78bfa', fontSize: 12, fontWeight: 700, lineHeight: 1 }}>—</span>}
    </div>
  );
}

export default function SettingsPage() {
  const [accountId,  setAccountId]  = useState(null);   // 目前登入帳號 ID
  const [accountName, setAccountName] = useState('');   // 顯示帳號名稱
  const [allGroups,  setAllGroups]  = useState([]);
  const [selected,   setSelected]   = useState(null);   // null=全選, Set=指定 chatId
  const [search,     setSearch]     = useState('');
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');
  const [savedMsg,   setSavedMsg]   = useState('');
  const savedTimer = useRef(null);

  // ── Mount：先取得目前帳號，再讀取該帳號的快取 ──────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const data = await fetch('/api/accounts', { credentials: 'same-origin' }).then(r => r.json());
        const aid  = data.activeAccountId;
        const acct = data.accounts?.find(a => a.id === aid);
        if (!aid) return;
        setAccountId(aid);
        setAccountName(acct?.name || acct?.phone || '');

        // 讀取此帳號已快取的群組清單與選擇狀態
        const cached = getFolderGroups(0, aid);
        if (cached?.length) {
          setAllGroups(cached);
          const sel = getSelectedGroupsInFolder(0, aid);
          setSelected(sel === null ? null : new Set((sel || []).map(g => g.chatId)));
        }
      } catch {}
    })();
  }, []);

  // ── 自動儲存（每次 toggle 後呼叫）────────────────────────────────────────
  function persistSelection(newSelected, groups) {
    if (!accountId) return;
    const gs = groups || allGroups;

    // 確保 folderId=0 和 known folders 都已設定（per account）
    saveSelectedFolderId(0, accountId);
    const known = getKnownFolders(accountId);
    if (!known.find(f => f.id === 0)) {
      saveKnownFolders([{ id: 0, title: '所有聊天' }, ...known], accountId);
    }

    if (newSelected === null) {
      saveSelectedGroupsInFolder(0, null, accountId);
    } else {
      const arr = gs.filter(g => newSelected.has(g.chatId));
      saveSelectedGroupsInFolder(0, arr, accountId);
    }

    // 短暫顯示「已儲存」提示
    clearTimeout(savedTimer.current);
    setSavedMsg('✓ 已儲存');
    savedTimer.current = setTimeout(() => setSavedMsg(''), 1200);
  }

  // ── 取得群組清單 ──────────────────────────────────────────────────────────
  async function fetchGroups() {
    if (!accountId) return;
    setLoading(true); setError('');
    try {
      const res  = await fetch('/api/groups', { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const gs = data.groups || [];
      setAllGroups(gs);
      saveFolderGroups(0, gs, accountId);

      // 清理已不存在的 chatId
      const ids = new Set(gs.map(g => g.chatId));
      const prevSel = getSelectedGroupsInFolder(0, accountId);
      let newSel = null;
      if (prevSel !== null) {
        const cleaned = (prevSel || []).filter(g => ids.has(g.chatId));
        newSel = cleaned.length === gs.length ? null : new Set(cleaned.map(g => g.chatId));
      }
      setSelected(newSel);
      persistSelection(newSel, gs);
    } catch (e) {
      setError(e.message || '取得失敗，請稍後再試');
    }
    setLoading(false);
  }

  // ── 全選切換 ──────────────────────────────────────────────────────────────
  function toggleAll() {
    const newSel = isAllSelected ? new Set() : null;
    setSelected(newSel);
    persistSelection(newSel);
  }

  // ── 個別群組切換 ──────────────────────────────────────────────────────────
  function toggleGroup(chatId) {
    let newSel;
    if (selected === null) {
      newSel = new Set(allGroups.map(g => g.chatId));
      newSel.delete(chatId);
    } else {
      newSel = new Set(selected);
      if (newSel.has(chatId)) {
        newSel.delete(chatId);
      } else {
        newSel.add(chatId);
        if (newSel.size >= allGroups.length) newSel = null;
      }
    }
    setSelected(newSel);
    persistSelection(newSel);
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const isAllSelected = selected === null ||
    (selected instanceof Set && allGroups.length > 0 && selected.size >= allGroups.length);

  const selectedCount = selected === null
    ? allGroups.length
    : (selected instanceof Set ? selected.size : 0);

  const isIndeterminate = !isAllSelected && selectedCount > 0;

  function isChecked(chatId) {
    return selected === null || (selected instanceof Set && selected.has(chatId));
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return allGroups;
    const q = search.toLowerCase();
    return allGroups.filter(g => g.chatTitle.toLowerCase().includes(q));
  }, [allGroups, search]);

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
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
        .group-row { animation: fadeIn 0.12s ease both; transition: background 0.1s; }
        .group-row:active { background: #1e1a2e !important; }
      `}</style>

      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(13,13,15,0.9)', backdropFilter: 'blur(14px)',
        borderBottom: '1px solid #1f1f23', display: 'flex', alignItems: 'center',
        padding: '0 16px', height: 56, gap: 12 }}>
        <Link href="/" style={{ color: '#a1a1aa', fontSize: 22, textDecoration: 'none', lineHeight: 1 }}>←</Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 17, fontWeight: 700 }}>設定</h1>
          {accountName && (
            <p style={{ fontSize: 11, color: '#52525b', marginTop: 1,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              帳號：{accountName}
            </p>
          )}
        </div>
        {savedMsg && (
          <span style={{ fontSize: 12, color: '#4ade80', flexShrink: 0, transition: 'opacity 0.3s' }}>
            {savedMsg}
          </span>
        )}
      </header>

      <main style={{ padding: '16px', paddingBottom: 80 }}>

        {/* ── 取得群組按鈕 ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 12 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>👥 選擇群組與頻道</h2>
            <p style={{ fontSize: 12, color: '#71717a', marginTop: 4, lineHeight: 1.6 }}>
              取得帳號中的所有群組，勾選後自動儲存為影片來源。每個帳號各自獨立儲存設定。
            </p>
          </div>

          <button
            onClick={fetchGroups}
            disabled={loading || !accountId}
            style={{ width: '100%', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 8,
              padding: '11px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600,
              background: loading ? '#1f1f23' : allGroups.length === 0 ? '#7c3aed' : '#18181b',
              color: loading ? '#71717a' : allGroups.length === 0 ? '#fff' : '#a78bfa',
              border: allGroups.length === 0 ? '1px solid transparent' : '1px solid #3f3f46',
              cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
              fontFamily: 'inherit' }}>
            {loading
              ? <><Spinner size={14} /> 取得中，請稍候…</>
              : allGroups.length === 0
                ? <>👥 取得所有群組</>
                : <>🔄 重新取得（共 {allGroups.length} 個）</>
            }
          </button>

          {error && (
            <div style={{ marginTop: 10, background: '#ef444422', border: '1px solid #ef444455',
              borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 12 }}>
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* ── 空狀態 ── */}
        {!loading && allGroups.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: '#52525b',
            background: '#111113', borderRadius: 12, border: '1px solid #1f1f23' }}>
            <div style={{ fontSize: 40, marginBottom: 10 }}>📭</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#3f3f46' }}>尚無群組資料</p>
            <p style={{ fontSize: 12, marginTop: 6 }}>點擊上方按鈕取得所有群組</p>
          </div>
        )}

        {/* ── 群組清單 ── */}
        {allGroups.length > 0 && (
          <>
            {/* 搜尋 + 全選 */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  type="search"
                  placeholder="搜尋群組名稱…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  style={{ width: '100%', background: '#18181b', border: '1px solid #2e2e35',
                    borderRadius: 8, padding: '8px 12px 8px 34px',
                    color: '#f4f4f5', fontSize: 13, outline: 'none', fontFamily: 'inherit' }}
                />
                <span style={{ position: 'absolute', left: 10, top: '50%',
                  transform: 'translateY(-50%)', color: '#52525b', fontSize: 14 }}>🔍</span>
                {search && (
                  <button onClick={() => setSearch('')}
                    style={{ position: 'absolute', right: 8, top: '50%',
                      transform: 'translateY(-50%)', background: 'none',
                      color: '#52525b', fontSize: 16, cursor: 'pointer', border: 'none' }}>×</button>
                )}
              </div>
              <button
                onClick={toggleAll}
                style={{ flexShrink: 0, padding: '8px 14px', borderRadius: 8, fontSize: 12,
                  fontWeight: 600, cursor: 'pointer', border: '1px solid #3f3f46',
                  background: isAllSelected ? '#7c3aed22' : 'transparent',
                  color: isAllSelected ? '#a78bfa' : '#71717a',
                  transition: 'all 0.15s', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckBox checked={isAllSelected} indeterminate={isIndeterminate} />
                全選
              </button>
            </div>

            {/* 已選統計 */}
            <div style={{ marginBottom: 10, fontSize: 12, color: '#52525b', textAlign: 'right' }}>
              已選{' '}
              <span style={{ color: '#a78bfa', fontWeight: 600 }}>{selectedCount}</span>
              {' '}/ {allGroups.length} 個
              {search && <span style={{ marginLeft: 6 }}>（顯示 {filtered.length} 筆）</span>}
            </div>

            {/* 清單 */}
            <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #1f1f23' }}>
              {filtered.length === 0 ? (
                <div style={{ padding: '24px', textAlign: 'center', color: '#52525b', fontSize: 13 }}>
                  無符合「{search}」的群組
                </div>
              ) : (
                filtered.map((g, i) => {
                  const checked = isChecked(g.chatId);
                  return (
                    <div key={g.chatId}
                      className="group-row"
                      onClick={() => toggleGroup(g.chatId)}
                      style={{ animationDelay: `${Math.min(i * 0.012, 0.3)}s`,
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '12px 16px',
                        background: checked ? '#100d18' : '#111113',
                        borderBottom: i < filtered.length - 1 ? '1px solid #1a1a1e' : 'none',
                        cursor: 'pointer',
                        borderLeft: `3px solid ${checked ? '#7c3aed' : 'transparent'}` }}>
                      <CheckBox checked={checked} />
                      <span style={{ fontSize: 18, flexShrink: 0 }}>
                        {g.chatType === 'channel' ? '📢' : '👥'}
                      </span>
                      <span style={{ flex: 1, fontSize: 14, fontWeight: checked ? 500 : 400,
                        color: checked ? '#d4d4d8' : '#71717a',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {g.chatTitle}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* ── 關於 ── */}
        <div style={{ marginTop: 24, borderRadius: 12, background: '#111113',
          border: '1px solid #1f1f23', padding: '14px 16px', textAlign: 'center' }}>
          <p style={{ fontSize: 13, color: '#52525b' }}>Telegram 影片瀏覽器</p>
          <p style={{ fontSize: 18, fontWeight: 700, color: '#3f3f46', marginTop: 4 }}>v1.2</p>
        </div>
      </main>

      <NavBar active="settings" />
    </>
  );
}
