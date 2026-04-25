import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDuration(secs) {
  if (!secs) return '';
  const m = Math.floor(secs / 60), s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function fmtBytes(b) {
  if (!b) return '';
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}
function fmtDate(unix) {
  return new Date(unix * 1000).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Components ───────────────────────────────────────────────────────────────

function Spinner({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ animation: 'spin 0.8s linear infinite' }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round" />
    </svg>
  );
}

function Btn({ children, onClick, disabled, variant = 'primary', style: s, ...p }) {
  const base = {
    padding: '10px 20px', borderRadius: 8, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', gap: 8,
    transition: 'all 0.15s', userSelect: 'none',
    opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
    ...s,
  };
  const variants = {
    primary: { background: '#7c3aed', color: '#fff' },
    ghost: { background: 'transparent', color: '#a1a1aa', border: '1px solid #2e2e35' },
    danger: { background: '#ef444422', color: '#ef4444', border: '1px solid #ef444455' },
  };
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant] }} {...p}>
      {children}
    </button>
  );
}

// ─── Login Wizard ─────────────────────────────────────────────────────────────

function LoginPage({ onLoggedIn }) {
  const [step, setStep] = useState('credentials'); // credentials | phone | code | password
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    apiId: '', apiHash: '', phone: '', code: '', password: '',
    phoneCodeHash: '', partialSession: '',
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const err = (e) => { setError(e.message || String(e)); setLoading(false); };

  async function handleCredentials(e) {
    e.preventDefault();
    if (!form.apiId || !form.apiHash) return setError('請填入 API ID 和 API Hash');
    setStep('phone'); setError('');
  }

  async function handlePhone(e) {
    e.preventDefault();
    if (!form.phone) return setError('請填入手機號碼');
    setLoading(true); setError('');
    try {
      const { phoneCodeHash } = await api('/api/auth/send-code', {
        method: 'POST', body: { apiId: form.apiId, apiHash: form.apiHash, phone: form.phone },
      });
      setForm((f) => ({ ...f, phoneCodeHash }));
      setStep('code');
    } catch (e) { err(e); }
    setLoading(false);
  }

  async function handleCode(e) {
    e.preventDefault();
    if (!form.code) return setError('請輸入驗證碼');
    setLoading(true); setError('');
    try {
      const result = await api('/api/auth/verify-code', {
        method: 'POST',
        body: { apiId: form.apiId, apiHash: form.apiHash, phone: form.phone, phoneCodeHash: form.phoneCodeHash, code: form.code },
      });
      if (result.needsPassword) {
        setForm((f) => ({ ...f, partialSession: result.partialSession }));
        setStep('password');
      } else {
        onLoggedIn(result.account);
      }
    } catch (e) { err(e); }
    setLoading(false);
  }

  async function handlePassword(e) {
    e.preventDefault();
    if (!form.password) return setError('請輸入兩步驟驗證密碼');
    setLoading(true); setError('');
    try {
      const result = await api('/api/auth/verify-2fa', {
        method: 'POST',
        body: { apiId: form.apiId, apiHash: form.apiHash, phone: form.phone, partialSession: form.partialSession, password: form.password },
      });
      onLoggedIn(result.account);
    } catch (e) { err(e); }
    setLoading(false);
  }

  const steps = { credentials: '取得 API 憑證', phone: '手機號碼', code: '驗證碼', password: '兩步驟驗證' };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📺</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#f4f4f5' }}>Telegram 影片瀏覽器</h1>
          <p style={{ color: '#71717a', marginTop: 6 }}>瀏覽群組中的所有影片</p>
        </div>

        {/* Step indicators */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 32, justifyContent: 'center' }}>
          {Object.entries(steps).map(([k, label], i) => (
            <div key={k} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              opacity: step === k ? 1 : 0.35, transition: 'opacity 0.2s',
            }}>
              <div style={{
                width: 24, height: 24, borderRadius: '50%', fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: step === k ? '#7c3aed' : '#27272b', color: '#fff',
              }}>{i + 1}</div>
              <span style={{ fontSize: 12, color: '#a1a1aa', display: window?.innerWidth > 500 ? 'inline' : 'none' }}>{label}</span>
              {i < 3 && <span style={{ color: '#3f3f46' }}>→</span>}
            </div>
          ))}
        </div>

        {/* Card */}
        <div style={{ background: '#18181b', borderRadius: 16, padding: 28, border: '1px solid #27272b' }}>
          {error && (
            <div style={{ background: '#ef444422', border: '1px solid #ef444455', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', marginBottom: 20, fontSize: 13 }}>
              ⚠️ {error}
            </div>
          )}

          {step === 'credentials' && (
            <form onSubmit={handleCredentials}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Telegram API 憑證</h2>
              <p style={{ color: '#71717a', fontSize: 13, marginBottom: 20 }}>
                前往 <a href="https://my.telegram.org" target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>my.telegram.org</a> → API Development Tools 取得憑證
              </p>
              <label style={{ display: 'block', marginBottom: 14 }}>
                <span style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 6, display: 'block' }}>API ID</span>
                <input type="number" placeholder="12345678" value={form.apiId} onChange={set('apiId')} autoFocus />
              </label>
              <label style={{ display: 'block', marginBottom: 24 }}>
                <span style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 6, display: 'block' }}>API Hash</span>
                <input type="text" placeholder="abcdef1234567890..." value={form.apiHash} onChange={set('apiHash')} />
              </label>
              <Btn type="submit" style={{ width: '100%', justifyContent: 'center' }}>繼續</Btn>
            </form>
          )}

          {step === 'phone' && (
            <form onSubmit={handlePhone}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>輸入手機號碼</h2>
              <p style={{ color: '#71717a', fontSize: 13, marginBottom: 20 }}>請輸入國碼，例如 +886912345678</p>
              <label style={{ display: 'block', marginBottom: 24 }}>
                <span style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 6, display: 'block' }}>手機號碼</span>
                <input type="tel" placeholder="+886912345678" value={form.phone} onChange={set('phone')} autoFocus />
              </label>
              <div style={{ display: 'flex', gap: 10 }}>
                <Btn variant="ghost" onClick={() => setStep('credentials')}>← 返回</Btn>
                <Btn type="submit" disabled={loading} style={{ flex: 1, justifyContent: 'center' }}>
                  {loading ? <Spinner size={16} /> : '發送驗證碼'}
                </Btn>
              </div>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={handleCode}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>輸入驗證碼</h2>
              <p style={{ color: '#71717a', fontSize: 13, marginBottom: 20 }}>Telegram 已發送驗證碼至 {form.phone}</p>
              <label style={{ display: 'block', marginBottom: 24 }}>
                <span style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 6, display: 'block' }}>5 位數驗證碼</span>
                <input type="text" inputMode="numeric" placeholder="12345" maxLength={8} value={form.code} onChange={set('code')} autoFocus style={{ letterSpacing: '0.3em', fontSize: 22, textAlign: 'center' }} />
              </label>
              <div style={{ display: 'flex', gap: 10 }}>
                <Btn variant="ghost" onClick={() => setStep('phone')}>← 返回</Btn>
                <Btn type="submit" disabled={loading} style={{ flex: 1, justifyContent: 'center' }}>
                  {loading ? <Spinner size={16} /> : '登入'}
                </Btn>
              </div>
            </form>
          )}

          {step === 'password' && (
            <form onSubmit={handlePassword}>
              <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>兩步驟驗證</h2>
              <p style={{ color: '#71717a', fontSize: 13, marginBottom: 20 }}>請輸入你的兩步驟驗證密碼</p>
              <label style={{ display: 'block', marginBottom: 24 }}>
                <span style={{ color: '#a1a1aa', fontSize: 12, marginBottom: 6, display: 'block' }}>密碼</span>
                <input type="password" placeholder="••••••••" value={form.password} onChange={set('password')} autoFocus />
              </label>
              <Btn type="submit" disabled={loading} style={{ width: '100%', justifyContent: 'center' }}>
                {loading ? <Spinner size={16} /> : '驗證'}
              </Btn>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Video Card ────────────────────────────────────────────────────────────────

function VideoCard({ video, cardSize, onClick }) {
  const thumbSrc = `/api/thumb?chatId=${video.chatId}&msgId=${video.msgId}&accessHash=${video.accessHash}&chatType=${video.chatType}&accountId=${video.accountId}`;
  const [imgErr, setImgErr] = useState(false);
  const [hover, setHover] = useState(false);

  return (
    <div
      onClick={() => onClick(video)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? '#27272b' : '#1f1f23',
        borderRadius: 12,
        overflow: 'hidden',
        cursor: 'pointer',
        border: '1px solid #2e2e35',
        transition: 'transform 0.15s, background 0.15s, box-shadow 0.15s',
        transform: hover ? 'translateY(-2px)' : 'none',
        boxShadow: hover ? '0 8px 24px rgba(0,0,0,0.4)' : 'none',
      }}
    >
      {/* Thumbnail */}
      <div style={{ position: 'relative', aspectRatio: '16/9', background: '#111113', overflow: 'hidden' }}>
        {video.hasThumbnail && !imgErr ? (
          <img
            src={thumbSrc}
            alt=""
            onError={() => setImgErr(true)}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, opacity: 0.3 }}>🎬</div>
        )}
        {/* Play overlay */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.3)', opacity: hover ? 1 : 0, transition: 'opacity 0.15s',
        }}>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(124,58,237,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>▶</div>
        </div>
        {/* Duration badge */}
        {video.duration > 0 && (
          <div style={{ position: 'absolute', bottom: 6, right: 6, background: 'rgba(0,0,0,0.75)', color: '#fff', borderRadius: 4, padding: '2px 6px', fontSize: 11, fontWeight: 600 }}>
            {fmtDuration(video.duration)}
          </div>
        )}
      </div>
      {/* Meta */}
      <div style={{ padding: '10px 12px' }}>
        <p style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', marginBottom: 6, color: '#f4f4f5' }}>
          {video.title || '影片'}
        </p>
        <p style={{ fontSize: 11, color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{video.chatTitle}</p>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: '#52525b' }}>
          <span>{fmtDate(video.date)}</span>
          <span>{fmtBytes(video.fileSize)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Video Modal ───────────────────────────────────────────────────────────────

function VideoModal({ video, onClose }) {
  const [progress, setProgress] = useState(null); // null = not started, 0-100 = downloading, -1 = error
  const [ready, setReady] = useState(false);
  const esRef = useRef(null);
  const videoRef = useRef(null);

  const streamUrl = video
    ? `/api/stream?chatId=${video.chatId}&msgId=${video.msgId}&accessHash=${video.accessHash}&chatType=${video.chatType}&mimeType=${encodeURIComponent(video.mimeType)}&accountId=${video.accountId}`
    : '';

  // Poll download progress
  useEffect(() => {
    if (!video) return;
    setProgress(0); setReady(false);

    const progUrl = `/api/stream-progress?chatId=${video.chatId}&msgId=${video.msgId}&accountId=${video.accountId}`;
    const es = new EventSource(progUrl);
    esRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.error) { setProgress(-1); es.close(); return; }
      setProgress(data.pct || 0);
      if (data.done) { setReady(true); es.close(); }
    };
    es.onerror = () => { es.close(); };

    // Trigger the actual download by making a HEAD-like request
    fetch(streamUrl, { method: 'GET', credentials: 'same-origin' }).catch(() => {});

    return () => { es.close(); };
  }, [video?.id]);

  // Close on backdrop click
  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose(); };

  // Close on Escape
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!video) return null;

  return (
    <div onClick={handleBackdrop} style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{ width: '100%', maxWidth: 900, background: '#18181b', borderRadius: 16, border: '1px solid #27272b', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid #27272b' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.4 }}>{video.title || '影片'}</p>
            <p style={{ color: '#71717a', fontSize: 12, marginTop: 3 }}>{video.chatTitle} · {fmtDate(video.date)} · {fmtBytes(video.fileSize)}</p>
          </div>
          <button onClick={onClose} style={{ color: '#71717a', fontSize: 22, background: 'none', lineHeight: 1, flexShrink: 0, cursor: 'pointer' }}>×</button>
        </div>

        {/* Video area */}
        <div style={{ background: '#000', position: 'relative' }}>
          {!ready && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 2 }}>
              <Spinner size={40} />
              <div style={{ textAlign: 'center' }}>
                <p style={{ color: '#f4f4f5', fontWeight: 600 }}>
                  {progress === -1 ? '下載失敗' : `下載中… ${progress ?? 0}%`}
                </p>
                <p style={{ color: '#71717a', fontSize: 12, marginTop: 4 }}>首次播放需要完整下載，之後可即時串流</p>
              </div>
              {progress !== null && progress >= 0 && progress < 100 && (
                <div style={{ width: 200, height: 4, background: '#27272b', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${progress}%`, background: '#7c3aed', borderRadius: 2, transition: 'width 0.3s' }} />
                </div>
              )}
            </div>
          )}
          <video
            ref={videoRef}
            src={ready ? streamUrl : undefined}
            controls
            autoPlay={ready}
            style={{ width: '100%', aspectRatio: video.width && video.height ? `${video.width}/${video.height}` : '16/9', display: 'block', opacity: ready ? 1 : 0, transition: 'opacity 0.3s' }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Account Switcher ─────────────────────────────────────────────────────────

function AccountSwitcher({ accounts, activeId, onSwitch, onAdd, onLogout }) {
  const [open, setOpen] = useState(false);
  const active = accounts.find((a) => a.id === activeId);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: '#27272b', color: '#f4f4f5', border: '1px solid #3f3f46',
          borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
        }}
      >
        <span style={{ width: 26, height: 26, borderRadius: '50%', background: '#7c3aed', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#fff' }}>
          {(active?.name || '?')[0].toUpperCase()}
        </span>
        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
          {active?.name || '帳號'}
        </span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>▼</span>
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
          <div style={{
            position: 'absolute', right: 0, top: '110%', zIndex: 100,
            background: '#18181b', border: '1px solid #2e2e35', borderRadius: 12,
            minWidth: 200, boxShadow: '0 12px 32px rgba(0,0,0,0.5)', overflow: 'hidden',
          }}>
            <div style={{ padding: '8px 0' }}>
              {accounts.map((acc) => (
                <div key={acc.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', gap: 10 }}>
                  <button
                    onClick={() => { onSwitch(acc.id); setOpen(false); }}
                    style={{
                      flex: 1, background: 'none', color: acc.id === activeId ? '#a78bfa' : '#f4f4f5',
                      textAlign: 'left', fontSize: 13, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{acc.name}</span>
                    <span style={{ fontSize: 11, color: '#52525b' }}>{acc.phone}</span>
                  </button>
                  {acc.id === activeId && <span style={{ color: '#7c3aed', fontSize: 14 }}>✓</span>}
                  <button
                    onClick={() => { onLogout(acc.id); setOpen(false); }}
                    style={{ background: 'none', color: '#71717a', fontSize: 14, cursor: 'pointer' }}
                    title="登出此帳號"
                  >✕</button>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid #27272b', padding: '8px 0' }}>
              <button
                onClick={() => { onAdd(); setOpen(false); }}
                style={{ width: '100%', padding: '10px 14px', background: 'none', color: '#a78bfa', textAlign: 'left', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
              >
                ＋ 新增帳號
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [view, setView] = useState('loading'); // loading | login | main
  const [accounts, setAccounts] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [videos, setVideos] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [scanTotal, setScanTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [cardSize, setCardSize] = useState(260);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [maxGroups, setMaxGroups] = useState(30);
  const esRef = useRef(null);
  const searchTimer = useRef(null);

  // Load accounts on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await api('/api/accounts');
        if (data.accounts?.length) {
          setAccounts(data.accounts);
          setActiveId(data.activeAccountId);
          setView('main');
        } else {
          setView('login');
        }
      } catch {
        setView('login');
      }
    })();
  }, []);

  // Scan videos
  const scanVideos = useCallback((searchQ = '', accountId) => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setVideos([]);
    setScanning(true);
    setScanStatus('連線中…');
    setScanTotal(0);

    const accId = accountId || activeId;
    const params = new URLSearchParams({ search: searchQ, maxGroups, accountId: accId });
    const es = new EventSource(`/api/videos?${params}`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'total_chats') setScanStatus(`掃描 ${data.count} 個群組…`);
        if (data.type === 'scanning') setScanStatus(`掃描中：${data.chat}`);
        if (data.type === 'video') setVideos((v) => [data.video, ...v].sort((a, b) => b.date - a.date));
        if (data.type === 'done') { setScanTotal(data.total); setScanning(false); setScanStatus(''); es.close(); }
        if (data.type === 'error') { setScanning(false); setScanStatus(`錯誤：${data.message}`); es.close(); }
      } catch {}
    };
    es.onerror = () => { setScanning(false); setScanStatus('連線中斷'); es.close(); };
  }, [activeId, maxGroups]);

  // Auto-scan when entering main view
  useEffect(() => {
    if (view === 'main' && activeId) scanVideos('', activeId);
  }, [view, activeId]);

  // Debounced search
  const handleSearch = (val) => {
    setSearch(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      if (!scanning) scanVideos(val);
      else {
        // Filter locally on cached results while scanning
        // (re-scan will be triggered if needed)
      }
    }, 600);
  };

  async function handleSwitch(id) {
    await api('/api/accounts?action=switch', { method: 'POST', body: { id } });
    setActiveId(id);
    setAccounts((prev) => prev.map((a) => ({ ...a, active: a.id === id })));
    scanVideos('', id);
  }

  async function handleLogout(id) {
    await api('/api/accounts?action=logout', { method: 'POST', body: { id } });
    const data = await api('/api/accounts');
    setAccounts(data.accounts || []);
    setActiveId(data.activeAccountId);
    if (!data.accounts?.length) setView('login');
    else scanVideos('', data.activeAccountId);
  }

  function handleLoggedIn(account) {
    setAccounts((prev) => {
      const next = prev.filter((a) => a.id !== account.id);
      return [...next, account];
    });
    setActiveId(account.id);
    setView('main');
  }

  // Filtered videos (client-side search while scanning)
  const filteredVideos = search
    ? videos.filter((v) => {
        const q = search.toLowerCase();
        return v.title?.toLowerCase().includes(q) || v.chatTitle?.toLowerCase().includes(q);
      })
    : videos;

  if (view === 'loading') return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spinner size={32} />
    </div>
  );

  if (view === 'login') return (
    <>
      <Head><title>Telegram 影片瀏覽器</title></Head>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <LoginPage onLoggedIn={handleLoggedIn} />
    </>
  );

  return (
    <>
      <Head><title>Telegram 影片瀏覽器</title></Head>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .video-card { animation: fadeIn 0.2s ease both; }
      `}</style>

      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'rgba(13,13,15,0.85)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #1f1f23', padding: '0 20px',
        display: 'flex', alignItems: 'center', gap: 16, height: 60,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 22 }}>📺</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: '#f4f4f5', display: window?.innerWidth > 600 ? 'inline' : 'none' }}>TG影片</span>
        </div>

        {/* Search */}
        <div style={{ flex: 1, position: 'relative', maxWidth: 480 }}>
          <input
            type="search"
            placeholder="搜尋影片標題或群組…"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            style={{ paddingLeft: 38, borderRadius: 20, background: '#18181b' }}
          />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#52525b', fontSize: 16 }}>🔍</span>
        </div>

        {/* Rescan */}
        <Btn
          variant="ghost"
          onClick={() => scanVideos(search)}
          disabled={scanning}
          style={{ flexShrink: 0, padding: '8px 14px', fontSize: 13 }}
        >
          {scanning ? <Spinner size={14} /> : '↻'} 重新掃描
        </Btn>

        {/* Account switcher */}
        <AccountSwitcher
          accounts={accounts}
          activeId={activeId}
          onSwitch={handleSwitch}
          onAdd={() => setView('login')}
          onLogout={handleLogout}
        />
      </header>

      {/* Sub-header: scan status + controls */}
      <div style={{
        padding: '10px 20px', background: '#18181b', borderBottom: '1px solid #1f1f23',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        {/* Status */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {scanning && <Spinner size={14} />}
          <span style={{ color: '#71717a', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {scanning ? scanStatus : `共 ${filteredVideos.length} 支影片${scanTotal ? `（掃描完成）` : ''}`}
          </span>
        </div>

        {/* Max groups setting */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#71717a', flexShrink: 0 }}>
          <span>掃描群組上限</span>
          <select
            value={maxGroups}
            onChange={(e) => setMaxGroups(Number(e.target.value))}
            style={{ background: '#27272b', color: '#f4f4f5', border: '1px solid #3f3f46', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}
          >
            {[10, 20, 30, 50, 100].map((n) => <option key={n} value={n}>{n} 個</option>)}
          </select>
        </div>

        {/* Card size slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#71717a', flexShrink: 0 }}>
          <span>卡片大小</span>
          <input
            type="range" min={160} max={400} step={20}
            value={cardSize}
            onChange={(e) => setCardSize(Number(e.target.value))}
            style={{ width: 90, accentColor: '#7c3aed' }}
          />
          <span style={{ minWidth: 36 }}>{cardSize}px</span>
        </div>
      </div>

      {/* Video Grid */}
      <main style={{ padding: '20px', minHeight: 'calc(100vh - 120px)' }}>
        {filteredVideos.length === 0 && !scanning && (
          <div style={{ textAlign: 'center', padding: '80px 20px', color: '#52525b' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🎬</div>
            <p style={{ fontSize: 18, fontWeight: 600, color: '#3f3f46' }}>
              {search ? '找不到符合的影片' : '尚未找到影片'}
            </p>
            <p style={{ marginTop: 8, fontSize: 14 }}>
              {search ? '請嘗試不同的關鍵字' : '點擊「重新掃描」來搜尋群組影片'}
            </p>
          </div>
        )}

        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize}px, 1fr))`,
          gap: 16,
        }}>
          {filteredVideos.map((v, i) => (
            <div key={v.id} className="video-card" style={{ animationDelay: `${Math.min(i * 0.03, 0.5)}s` }}>
              <VideoCard video={v} cardSize={cardSize} onClick={setSelectedVideo} />
            </div>
          ))}
        </div>
      </main>

      {/* Video Modal */}
      {selectedVideo && (
        <VideoModal
          video={selectedVideo}
          onClose={() => setSelectedVideo(null)}
        />
      )}
    </>
  );
}
