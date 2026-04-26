/**
 * /settings — 設定頁 v1.2
 * 兩層選擇：Telegram 文件夾 → 文件夾內群組
 * - 選擇文件夾（Radio）→ 自動展開群組列表
 * - 可選「全選此文件夾所有群組」或個別勾選群組
 * - 選擇結果透過 cookie（文件夾）+ localStorage（群組）儲存
 */
import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  getKnownFolders, saveKnownFolders,
  getSelectedFolderId, saveSelectedFolderId,
  getFolderGroups, saveFolderGroups,
  getSelectedGroupsInFolder, saveSelectedGroupsInFolder,
} from '../lib/storage';

// ─── Nav ───────────────────────────────────────────────────────────────────────
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

// 將可能是物件的 title 安全轉為字串（防止舊快取中殘留 TextWithEntities 物件）
function safeStr(v) {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof v.text === 'string') return v.text;
  return '';
}

function FolderIcon({ title }) {
  const t = safeStr(title).toLowerCase();
  if (!t) return <>📁</>;
  if (t === '所有聊天' || t === 'all chats') return <>💬</>;
  if (t.includes('personal') || t.includes('個人'))  return <>👤</>;
  if (t.includes('unread')   || t.includes('未讀'))  return <>🔔</>;
  if (t.includes('work')     || t.includes('工作'))  return <>💼</>;
  if (t.includes('sport')    || t.includes('運動'))  return <>🏃</>;
  if (t.includes('news')     || t.includes('新聞'))  return <>📰</>;
  if (t.includes('music')    || t.includes('音樂'))  return <>🎵</>;
  if (t.includes('video')    || t.includes('影片'))  return <>🎬</>;
  if (t.includes('fam')      || t.includes('家人'))  return <>👨‍👩‍👧</>;
  return <>📁</>;
}

function CheckBox({ checked }) {
  return (
    <div style={{ width: 18, height: 18, borderRadius: 5, flexShrink: 0,
      border: `2px solid ${checked ? '#7c3aed' : '#3f3f46'}`,
      background: checked ? '#7c3aed' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.15s' }}>
      {checked && <span style={{ color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: 1 }}>✓</span>}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [folders, setFolders]         = useState([]);
  const [selFolderId, setSelFolderId] = useState(null);
  const [expandedId, setExpandedId]   = useState(null);
  const [groups, setGroups]           = useState({});     // { folderId: group[] }
  const [loadingId, setLoadingId]     = useState(null);   // folderId 群組載入中
  const [selGroups, setSelGroups]     = useState({});     // { folderId: null | group[] }
  const [fetching, setFetching]       = useState(false);
  const [fetchError, setFetchError]   = useState('');
  const [saved, setSaved]             = useState(false);

  // ── Mount：讀快取 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const known = getKnownFolders();
    const fId   = getSelectedFolderId();
    setFolders(known);
    setSelFolderId(fId);

    const grpMap = {}, selMap = {};
    known.forEach(f => {
      const cached = getFolderGroups(f.id);
      if (cached?.length) grpMap[f.id] = cached;
      selMap[f.id] = getSelectedGroupsInFolder(f.id);
    });
    setGroups(grpMap);
    setSelGroups(selMap);

    if (known.length === 0) fetchFolders();
  }, []); // eslint-disable-line

  // ── 取得文件夾列表 ────────────────────────────────────────────────────────────
  async function fetchFolders() {
    setFetching(true); setFetchError('');
    try {
      const res  = await fetch('/api/folders', { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const fs = data.folders || [];
      saveKnownFolders(fs);
      setFolders(fs);
      setSelGroups(prev => {
        const updated = { ...prev };
        fs.forEach(f => { if (!(f.id in updated)) updated[f.id] = getSelectedGroupsInFolder(f.id); });
        return updated;
      });
    } catch (e) {
      setFetchError(e.message || '取得失敗，請稍後再試');
    }
    setFetching(false);
  }

  // ── 取得文件夾內群組（懶載入）────────────────────────────────────────────────
  async function fetchGroupsForFolder(folderId) {
    if (groups[folderId]?.length || loadingId === folderId) return;
    setLoadingId(folderId);
    try {
      const res  = await fetch(`/api/folder-groups?folderId=${folderId}`, { credentials: 'same-origin' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const gs = data.groups || [];
      setGroups(prev => ({ ...prev, [folderId]: gs }));
      saveFolderGroups(folderId, gs); // 快取供首頁 Mode A 用
    } catch {
      setGroups(prev => ({ ...prev, [folderId]: [] }));
    }
    setLoadingId(null);
  }

  function flash() { setSaved(true); setTimeout(() => setSaved(false), 1500); }

  // ── 選擇文件夾 ────────────────────────────────────────────────────────────────
  function selectFolder(folderId) {
    setSelFolderId(folderId);
    saveSelectedFolderId(folderId);
    setExpandedId(folderId);
    fetchGroupsForFolder(folderId);
    setSelGroups(prev => {
      if (prev[folderId] === undefined) return { ...prev, [folderId]: null };
      return prev;
    });
    flash();
  }

  // ── 展開 / 收合群組列表 ───────────────────────────────────────────────────────
  function toggleExpand(folderId, e) {
    e.stopPropagation();
    if (expandedId === folderId) {
      setExpandedId(null);
    } else {
      setExpandedId(folderId);
      fetchGroupsForFolder(folderId);
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────────
  function isAllSelected(folderId) {
    const sel = selGroups[folderId];
    return sel === null || sel === undefined;
  }

  function isGroupSelected(folderId, chatId) {
    const sel = selGroups[folderId];
    if (sel === null || sel === undefined) return true;
    return sel.some(g => g.chatId === chatId);
  }

  function getSelectionSummary(folderId) {
    const sel = selGroups[folderId];
    if (sel === null || sel === undefined) return '全部群組';
    if (sel.length === 0) return '全部群組';
    const gs = groups[folderId];
    if (gs && sel.length >= gs.length) return '全部群組';
    return `${sel.length} 個群組`;
  }

  // ── 全選切換 ──────────────────────────────────────────────────────────────────
  function toggleSelectAll(folderId) {
    if (isAllSelected(folderId)) {
      // null → 明確列出所有群組（方便逐一取消）
      const gs = groups[folderId] || [];
      setSelGroups(prev => ({ ...prev, [folderId]: [...gs] }));
      saveSelectedGroupsInFolder(folderId, [...gs]);
    } else {
      // 回到全選（null）
      setSelGroups(prev => ({ ...prev, [folderId]: null }));
      saveSelectedGroupsInFolder(folderId, null);
    }
    flash();
  }

  // ── 個別群組切換 ──────────────────────────────────────────────────────────────
  function toggleGroup(folderId, group) {
    if (selFolderId !== folderId) {
      setSelFolderId(folderId);
      saveSelectedFolderId(folderId);
    }
    const current = selGroups[folderId];
    const gs = groups[folderId] || [];
    let newSel;

    if (current === null || current === undefined) {
      // 全選 → 取消此群組
      newSel = gs.filter(g => g.chatId !== group.chatId);
      if (newSel.length === 0 || newSel.length >= gs.length) newSel = null;
    } else {
      const already = current.some(g => g.chatId === group.chatId);
      if (already) {
        newSel = current.filter(g => g.chatId !== group.chatId);
        if (newSel.length === 0) newSel = null; // 不允許空，回到全選
      } else {
        newSel = [...current, group];
        if (newSel.length >= gs.length) newSel = null; // 全部選了 → 改為 null
      }
    }

    setSelGroups(prev => ({ ...prev, [folderId]: newSel }));
    saveSelectedGroupsInFolder(folderId, newSel);
    flash();
  }

  // ── Render ────────────────────────────────────────────────────────────────────
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
        @keyframes slideDown { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
        @keyframes spin { to { transform: rotate(360deg); } }
        .folder-row { animation: fadeIn 0.15s ease both; }
        .group-row  { animation: slideDown 0.1s ease both; }
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

        {/* ── 文件夾 + 群組選擇 ── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ marginBottom: 14 }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>📂 選擇文件夾與群組</h2>
            <p style={{ fontSize: 12, color: '#71717a', marginTop: 4, lineHeight: 1.6 }}>
              選取一個 Telegram 文件夾作為影片來源。<br/>
              可展開文件夾，進一步選擇特定群組或頻道。
            </p>
          </div>

          {/* 取得文件夾按鈕 */}
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

          {/* ── 文件夾清單 ── */}
          {folders.length > 0 && (
            <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid #1f1f23' }}>
              {folders.map((folder, i) => {
                const isSelected   = selFolderId === folder.id;
                const isExpanded   = expandedId  === folder.id;
                const grpList      = groups[folder.id] || [];
                const isLoadingGrp = loadingId   === folder.id;
                const isLast       = i === folders.length - 1;
                const summary      = isSelected ? getSelectionSummary(folder.id) : null;

                return (
                  <div key={folder.id}>
                    {/* 文件夾列 */}
                    <div className="folder-row"
                      onClick={() => selectFolder(folder.id)}
                      style={{ animationDelay: `${Math.min(i * 0.04, 0.4)}s`,
                        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
                        background: isSelected ? '#1c1528' : '#111113',
                        borderBottom: (!isLast || isExpanded) ? '1px solid #1f1f23' : 'none',
                        cursor: 'pointer', transition: 'background 0.15s',
                        borderLeft: isSelected ? '3px solid #7c3aed' : '3px solid transparent' }}>

                      {/* Radio */}
                      <div style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                        border: `2px solid ${isSelected ? '#7c3aed' : '#3f3f46'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'all 0.15s' }}>
                        {isSelected && <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#7c3aed' }}/>}
                      </div>

                      {/* Icon */}
                      <span style={{ fontSize: 20, flexShrink: 0 }}>
                        <FolderIcon title={folder.title} />
                      </span>

                      {/* 名稱 + 已選摘要 */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontWeight: 600, fontSize: 15,
                          color: isSelected ? '#c4b5fd' : '#d4d4d8',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {safeStr(folder.title) || `文件夾 ${folder.id}`}
                        </p>
                        {isSelected && summary && (
                          <p style={{ fontSize: 11, color: '#7c3aed', marginTop: 2 }}>
                            已選：{summary}
                          </p>
                        )}
                      </div>

                      {/* 展開群組按鈕 */}
                      <button
                        onClick={e => toggleExpand(folder.id, e)}
                        style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                          color: isExpanded ? '#a78bfa' : '#71717a',
                          background: isExpanded ? '#7c3aed22' : 'transparent',
                          border: `1px solid ${isExpanded ? '#7c3aed55' : '#2e2e35'}`,
                          fontSize: 11, fontWeight: 600, transition: 'all 0.15s' }}>
                        {isLoadingGrp
                          ? <Spinner size={10}/>
                          : grpList.length > 0 ? `${grpList.length} 群` : '群組'
                        }
                        <span style={{ fontSize: 9, transition: 'transform 0.2s', display: 'inline-block',
                          transform: isExpanded ? 'rotate(180deg)' : 'none' }}>▼</span>
                      </button>
                    </div>

                    {/* 群組面板（展開） */}
                    {isExpanded && (
                      <div style={{ background: '#09090b',
                        borderBottom: !isLast ? '1px solid #1f1f23' : 'none' }}>

                        {/* 載入中 */}
                        {isLoadingGrp && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8,
                            padding: '14px 20px', color: '#52525b', fontSize: 12 }}>
                            <Spinner size={12}/> 載入群組中…
                          </div>
                        )}

                        {/* 沒有群組 */}
                        {!isLoadingGrp && grpList.length === 0 && (
                          <div style={{ padding: '14px 20px', color: '#3f3f46', fontSize: 12 }}>
                            此文件夾內沒有群組或頻道
                          </div>
                        )}

                        {/* 群組列表 */}
                        {!isLoadingGrp && grpList.length > 0 && (
                          <>
                            {/* 全選列 */}
                            <div className="group-row"
                              onClick={() => toggleSelectAll(folder.id)}
                              style={{ display: 'flex', alignItems: 'center', gap: 12,
                                padding: '12px 20px', cursor: 'pointer',
                                background: isAllSelected(folder.id) ? '#1a1028' : 'transparent',
                                borderBottom: '1px solid #16161a' }}>
                              <CheckBox checked={isAllSelected(folder.id)} />
                              <span style={{ flex: 1, fontSize: 13, fontWeight: 600,
                                color: isAllSelected(folder.id) ? '#c4b5fd' : '#a1a1aa' }}>
                                ✨ 全選此文件夾所有群組
                              </span>
                              <span style={{ fontSize: 10, color: '#52525b', flexShrink: 0 }}>
                                共 {grpList.length} 個
                              </span>
                            </div>

                            {/* 個別群組 */}
                            {grpList.map((g, gi) => {
                              const isSel = isGroupSelected(folder.id, g.chatId);
                              return (
                                <div key={g.chatId} className="group-row"
                                  onClick={() => toggleGroup(folder.id, g)}
                                  style={{ animationDelay: `${Math.min(gi * 0.018, 0.3)}s`,
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    padding: '10px 20px 10px 26px', cursor: 'pointer',
                                    background: isSel ? '#100d18' : 'transparent',
                                    borderBottom: gi < grpList.length - 1 ? '1px solid #111115' : 'none',
                                    transition: 'background 0.1s' }}>
                                  <CheckBox checked={isSel} />
                                  <span style={{ fontSize: 14, flexShrink: 0 }}>
                                    {g.chatType === 'channel' ? '📢' : '👥'}
                                  </span>
                                  <span style={{ flex: 1, fontSize: 13,
                                    color: isSel ? '#d4d4d8' : '#52525b',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    transition: 'color 0.1s' }}>
                                    {g.chatTitle}
                                  </span>
                                </div>
                              );
                            })}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* 選取說明 */}
          {selFolderId !== null && folders.length > 0 && (
            <p style={{ fontSize: 11, color: '#52525b', marginTop: 10, textAlign: 'center' }}>
              已選：
              <span style={{ color: '#a78bfa' }}>
                {safeStr(folders.find(f => f.id === selFolderId)?.title) || `文件夾 ${selFolderId}`}
              </span>
              {' → '}
              <span style={{ color: '#a78bfa' }}>{getSelectionSummary(selFolderId)}</span>
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
