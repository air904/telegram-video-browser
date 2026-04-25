import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import {
  toggleFavorite, addWatched, savePlaylist,
  getKnownGroups, saveKnownGroups,
  getSelectedGroupIds,
  saveCachedVideos, getCachedVideos, clearCachedVideos,
} from '../lib/storage';

// ─── 硬編碼 API 憑證 ──────────────────────────────────────────────────────────
const HARDCODED_API_ID   = '39092753';
const HARDCODED_API_HASH = '44a8b04d42db2e5aa092964c27b2943e';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDuration(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'00')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}
function fmtBytes(b) {
  if (!b) return '';
  if (b < 1024*1024)   return `${(b/1024).toFixed(0)} KB`;
  if (b < 1024**3)     return `${(b/1024/1024).toFixed(1)} MB`;
  return `${(b/1024**3).toFixed(2)} GB`;
}
function fmtDate(unix) {
  return new Date(unix*1000).toLocaleDateString('zh-TW',{month:'short',day:'numeric',year:'numeric'});
}

// ─── API helper ───────────────────────────────────────────────────────────────
async function api(url, opts={}) {
  const res = await fetch(url,{
    headers:{'Content-Type':'application/json'},
    credentials:'same-origin',
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
  return data;
}

// ─── Components ───────────────────────────────────────────────────────────────
function Spinner({size=20}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      style={{animation:'spin 0.8s linear infinite',flexShrink:0}}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor"
        strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/>
    </svg>
  );
}

function Btn({children,onClick,disabled,variant='primary',style:s,...p}) {
  const base={padding:'10px 20px',borderRadius:8,fontWeight:600,
    display:'inline-flex',alignItems:'center',gap:8,
    transition:'all 0.15s',userSelect:'none',
    opacity:disabled?0.5:1,cursor:disabled?'not-allowed':'pointer',...s};
  const variants={
    primary:{background:'#7c3aed',color:'#fff'},
    ghost:{background:'transparent',color:'#a1a1aa',border:'1px solid #2e2e35'},
    danger:{background:'#ef444422',color:'#ef4444',border:'1px solid #ef444455'},
  };
  return <button onClick={disabled?undefined:onClick} style={{...base,...variants[variant]}} {...p}>{children}</button>;
}

function NavBar({active}) {
  const items=[
    {href:'/',icon:'🏠',label:'首頁',key:'home'},
    {href:'/favorites',icon:'❤️',label:'最愛',key:'favorites'},
    {href:'/settings',icon:'⚙️',label:'設定',key:'settings'},
  ];
  return (
    <nav style={{position:'fixed',bottom:0,left:0,right:0,zIndex:100,
      background:'rgba(13,13,15,0.96)',backdropFilter:'blur(14px)',
      borderTop:'1px solid #1f1f23',display:'flex',height:58}}>
      {items.map(item=>(
        <Link key={item.key} href={item.href}
          style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',
            justifyContent:'center',gap:2,
            color:active===item.key?'#a78bfa':'#52525b',
            textDecoration:'none',fontSize:11,fontWeight:600,transition:'color 0.15s'}}>
          <span style={{fontSize:22}}>{item.icon}</span>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function Toast({message}) {
  if (!message) return null;
  return (
    <div style={{position:'fixed',bottom:72,left:'50%',transform:'translateX(-50%)',
      background:'#27272b',border:'1px solid #3f3f46',color:'#f4f4f5',
      padding:'10px 22px',borderRadius:24,fontSize:13,zIndex:2000,
      whiteSpace:'nowrap',pointerEvents:'none',boxShadow:'0 4px 16px rgba(0,0,0,0.4)'}}>
      {message}
    </div>
  );
}

// ─── Login Wizard ─────────────────────────────────────────────────────────────
function LoginPage({onLoggedIn}) {
  const [step,setStep]=useState('phone');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [form,setForm]=useState({phone:'',code:'',password:'',phoneCodeHash:'',sessionAfterCode:'',partialSession:''});
  const [countdown,setCountdown]=useState(0);
  const set=(k)=>(e)=>setForm(f=>({...f,[k]:e.target.value}));
  const err=(e)=>{setError(e.message||String(e));setLoading(false);};
  useEffect(()=>{if(countdown<=0)return;const t=setTimeout(()=>setCountdown(c=>c-1),1000);return()=>clearTimeout(t);},[countdown]);

  async function sendCode(){
    setLoading(true);setError('');
    try{
      const{phoneCodeHash,sessionAfterCode}=await api('/api/auth/send-code',{method:'POST',
        body:{apiId:HARDCODED_API_ID,apiHash:HARDCODED_API_HASH,phone:form.phone}});
      setForm(f=>({...f,phoneCodeHash,sessionAfterCode,code:''}));
      setCountdown(60);setStep('code');
    }catch(e){err(e);}
    setLoading(false);
  }
  async function handlePhone(e){e.preventDefault();if(!form.phone)return setError('請填入手機號碼');await sendCode();}
  async function handleCode(e){
    e.preventDefault();if(!form.code)return setError('請輸入驗證碼');
    setLoading(true);setError('');
    try{
      const result=await api('/api/auth/verify-code',{method:'POST',
        body:{apiId:HARDCODED_API_ID,apiHash:HARDCODED_API_HASH,
          phone:form.phone,phoneCodeHash:form.phoneCodeHash,
          code:form.code,sessionAfterCode:form.sessionAfterCode}});
      if(result.needsPassword){setForm(f=>({...f,partialSession:result.partialSession}));setStep('password');}
      else onLoggedIn(result.account);
    }catch(e){err(e);}
    setLoading(false);
  }
  async function handlePassword(e){
    e.preventDefault();if(!form.password)return setError('請輸入兩步驟驗證密碼');
    setLoading(true);setError('');
    try{
      const result=await api('/api/auth/verify-2fa',{method:'POST',
        body:{apiId:HARDCODED_API_ID,apiHash:HARDCODED_API_HASH,
          phone:form.phone,partialSession:form.partialSession,password:form.password}});
      onLoggedIn(result.account);
    }catch(e){err(e);}
    setLoading(false);
  }
  const stepLabels={phone:'手機號碼',code:'驗證碼',password:'兩步驟驗證'};
  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{width:'100%',maxWidth:420}}>
        <div style={{textAlign:'center',marginBottom:40}}>
          <div style={{fontSize:48,marginBottom:8}}>📺</div>
          <h1 style={{fontSize:24,fontWeight:700,color:'#f4f4f5'}}>Telegram 影片瀏覽器</h1>
          <p style={{color:'#71717a',marginTop:6}}>瀏覽群組中的所有影片</p>
        </div>
        <div style={{display:'flex',gap:6,marginBottom:32,justifyContent:'center'}}>
          {Object.entries(stepLabels).map(([k,label],i)=>(
            <div key={k} style={{display:'flex',alignItems:'center',gap:6,opacity:step===k?1:0.35,transition:'opacity 0.2s'}}>
              <div style={{width:24,height:24,borderRadius:'50%',fontSize:11,fontWeight:700,
                display:'flex',alignItems:'center',justifyContent:'center',
                background:step===k?'#7c3aed':'#27272b',color:'#fff'}}>{i+1}</div>
              <span style={{fontSize:12,color:'#a1a1aa'}}>{label}</span>
              {i<2&&<span style={{color:'#3f3f46'}}>→</span>}
            </div>
          ))}
        </div>
        <div style={{background:'#18181b',borderRadius:16,padding:28,border:'1px solid #27272b'}}>
          {error&&<div style={{background:'#ef444422',border:'1px solid #ef444455',borderRadius:8,padding:'10px 14px',color:'#fca5a5',marginBottom:20,fontSize:13}}>⚠️ {error}</div>}
          {step==='phone'&&(
            <form onSubmit={handlePhone}>
              <h2 style={{fontSize:18,fontWeight:600,marginBottom:6}}>輸入手機號碼</h2>
              <p style={{color:'#71717a',fontSize:13,marginBottom:20}}>請輸入包含國碼的手機號碼，例如 +886912345678</p>
              <label style={{display:'block',marginBottom:24}}>
                <span style={{color:'#a1a1aa',fontSize:12,marginBottom:6,display:'block'}}>手機號碼</span>
                <input type="tel" placeholder="+886912345678" value={form.phone} onChange={set('phone')} autoFocus/>
              </label>
              <Btn type="submit" disabled={loading} style={{width:'100%',justifyContent:'center'}}>
                {loading?<Spinner size={16}/>:'發送驗證碼'}
              </Btn>
            </form>
          )}
          {step==='code'&&(
            <form onSubmit={handleCode}>
              <h2 style={{fontSize:18,fontWeight:600,marginBottom:6}}>輸入驗證碼</h2>
              <p style={{color:'#71717a',fontSize:13,marginBottom:4}}>Telegram 已發送驗證碼至 {form.phone}</p>
              <p style={{color:'#52525b',fontSize:11,marginBottom:20}}>⏱ 驗證碼有效時間約 60 秒，請盡快輸入</p>
              <label style={{display:'block',marginBottom:16}}>
                <span style={{color:'#a1a1aa',fontSize:12,marginBottom:6,display:'block'}}>5 位數驗證碼</span>
                <input type="text" inputMode="numeric" placeholder="12345" maxLength={8} value={form.code} onChange={set('code')} autoFocus style={{letterSpacing:'0.3em',fontSize:22,textAlign:'center'}}/>
              </label>
              <div style={{textAlign:'center',marginBottom:20}}>
                <button type="button" onClick={()=>countdown<=0&&sendCode()} disabled={countdown>0||loading}
                  style={{background:'none',fontSize:13,color:countdown>0?'#52525b':'#a78bfa',
                    cursor:countdown>0?'default':'pointer',textDecoration:countdown>0?'none':'underline'}}>
                  {countdown>0?`重新發送（${countdown}s）`:'沒收到？重新發送驗證碼'}
                </button>
              </div>
              <div style={{display:'flex',gap:10}}>
                <Btn variant="ghost" onClick={()=>setStep('phone')}>← 返回</Btn>
                <Btn type="submit" disabled={loading} style={{flex:1,justifyContent:'center'}}>
                  {loading?<Spinner size={16}/>:'登入'}
                </Btn>
              </div>
            </form>
          )}
          {step==='password'&&(
            <form onSubmit={handlePassword}>
              <h2 style={{fontSize:18,fontWeight:600,marginBottom:6}}>兩步驟驗證</h2>
              <p style={{color:'#71717a',fontSize:13,marginBottom:20}}>請輸入你的兩步驟驗證密碼</p>
              <label style={{display:'block',marginBottom:24}}>
                <span style={{color:'#a1a1aa',fontSize:12,marginBottom:6,display:'block'}}>密碼</span>
                <input type="password" placeholder="••••••••" value={form.password} onChange={set('password')} autoFocus/>
              </label>
              <Btn type="submit" disabled={loading} style={{width:'100%',justifyContent:'center'}}>
                {loading?<Spinner size={16}/>:'驗證'}
              </Btn>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── VideoCard ────────────────────────────────────────────────────────────────
function VideoCard({video,onPlay,onLongPress,isWatched,isFav,thumbReady=true}) {
  const thumbSrc=`/api/thumb?chatId=${video.chatId}&msgId=${video.msgId}&accessHash=${video.accessHash}&chatType=${video.chatType}&accountId=${video.accountId}`;
  const [imgErr,setImgErr]=useState(false);
  const [hover,setHover]=useState(false);
  const [pressing,setPressing]=useState(false);
  const pressTimer=useRef(null);
  const didLongPress=useRef(false);
  const didMove=useRef(false);
  const touchOrigin=useRef(null);

  function startPress(e){
    didLongPress.current=false;didMove.current=false;
    if(e?.touches)touchOrigin.current={x:e.touches[0].clientX,y:e.touches[0].clientY};
    setPressing(true);
    pressTimer.current=setTimeout(()=>{
      if(!didMove.current){didLongPress.current=true;setPressing(false);onLongPress(video);}
    },600);
  }
  function handleTouchMove(e){
    if(!touchOrigin.current)return;
    const dx=Math.abs(e.touches[0].clientX-touchOrigin.current.x);
    const dy=Math.abs(e.touches[0].clientY-touchOrigin.current.y);
    if(dx>10||dy>10){didMove.current=true;clearTimeout(pressTimer.current);setPressing(false);}
  }
  function endPress(){
    clearTimeout(pressTimer.current);setPressing(false);
    if(!didLongPress.current&&!didMove.current)onPlay(video);
    didLongPress.current=false;didMove.current=false;touchOrigin.current=null;
  }
  function cancelPress(){
    clearTimeout(pressTimer.current);setPressing(false);
    didLongPress.current=false;didMove.current=false;touchOrigin.current=null;
  }
  return (
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>{setHover(false);cancelPress();}}
      onMouseDown={startPress} onMouseUp={endPress}
      onTouchStart={startPress} onTouchMove={handleTouchMove} onTouchEnd={endPress} onTouchCancel={cancelPress}
      style={{background:hover?'#27272b':'#1f1f23',borderRadius:12,overflow:'hidden',cursor:'pointer',
        border:`1px solid ${pressing?'#7c3aed':'#2e2e35'}`,
        transition:'transform 0.15s,background 0.15s,box-shadow 0.15s,border-color 0.15s',
        transform:pressing?'scale(0.97)':hover?'translateY(-2px)':'none',
        boxShadow:hover?'0 8px 24px rgba(0,0,0,0.4)':'none',
        userSelect:'none',WebkitUserSelect:'none',opacity:isWatched?0.65:1}}>
      <div style={{position:'relative',aspectRatio:'16/9',background:'#111113',overflow:'hidden'}}>
        {video.hasThumbnail&&!imgErr&&thumbReady?(
          <img src={thumbSrc} alt="" onError={()=>setImgErr(true)} loading="lazy"
            style={{width:'100%',height:'100%',objectFit:'cover',display:'block'}}/>
        ):(
          <div style={{width:'100%',height:'100%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:36,opacity:0.3}}>🎬</div>
        )}
        {isWatched&&<div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.4)'}}/>}
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',
          background:'rgba(0,0,0,0.3)',opacity:hover?1:0,transition:'opacity 0.15s'}}>
          <div style={{width:44,height:44,borderRadius:'50%',background:'rgba(124,58,237,0.9)',
            display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>▶</div>
        </div>
        {video.duration>0&&(
          <div style={{position:'absolute',bottom:6,right:6,background:'rgba(0,0,0,0.75)',
            color:'#fff',borderRadius:4,padding:'2px 6px',fontSize:11,fontWeight:600}}>
            {fmtDuration(video.duration)}
          </div>
        )}
        {isWatched&&<div style={{position:'absolute',top:6,left:6,background:'rgba(0,0,0,0.65)',color:'#a1a1aa',borderRadius:4,padding:'2px 6px',fontSize:10}}>👁 已看</div>}
        {isFav&&<div style={{position:'absolute',top:6,right:6,fontSize:14}}>❤️</div>}
      </div>
      <div style={{padding:'10px 12px'}}>
        <p style={{fontWeight:600,fontSize:13,lineHeight:1.4,overflow:'hidden',display:'-webkit-box',
          WebkitLineClamp:2,WebkitBoxOrient:'vertical',marginBottom:6,color:'#f4f4f5'}}>
          {video.title||'影片'}
        </p>
        <p style={{fontSize:11,color:'#71717a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{video.chatTitle}</p>
        <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontSize:11,color:'#52525b'}}>
          <span>{fmtDate(video.date)}</span>
          <span>{fmtBytes(video.fileSize)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Account Switcher ─────────────────────────────────────────────────────────
function AccountSwitcher({accounts,activeId,onSwitch,onAdd,onLogout}) {
  const [open,setOpen]=useState(false);
  const active=accounts.find(a=>a.id===activeId);
  return (
    <div style={{position:'relative'}}>
      <button onClick={()=>setOpen(!open)}
        style={{background:'#27272b',color:'#f4f4f5',border:'1px solid #3f3f46',borderRadius:8,
          padding:'8px 14px',display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
        <span style={{width:26,height:26,borderRadius:'50%',background:'#7c3aed',display:'flex',
          alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:'#fff',flexShrink:0}}>
          {(active?.name||'?')[0].toUpperCase()}
        </span>
        <span style={{maxWidth:110,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:13}}>{active?.name||'帳號'}</span>
        <span style={{fontSize:10,opacity:0.6}}>▼</span>
      </button>
      {open&&(
        <>
          <div onClick={()=>setOpen(false)} style={{position:'fixed',inset:0,zIndex:99}}/>
          <div style={{position:'absolute',right:0,top:'110%',zIndex:100,background:'#18181b',
            border:'1px solid #2e2e35',borderRadius:12,minWidth:200,
            boxShadow:'0 12px 32px rgba(0,0,0,0.5)',overflow:'hidden'}}>
            {accounts.map(acc=>(
              <div key={acc.id} style={{display:'flex',alignItems:'center',padding:'10px 14px',gap:10}}>
                <button onClick={()=>{onSwitch(acc.id);setOpen(false);}}
                  style={{flex:1,background:'none',color:acc.id===activeId?'#a78bfa':'#f4f4f5',
                    textAlign:'left',fontSize:13,cursor:'pointer',display:'flex',flexDirection:'column',gap:2}}>
                  <span style={{fontWeight:600}}>{acc.name}</span>
                  <span style={{fontSize:11,color:'#52525b'}}>{acc.phone}</span>
                </button>
                {acc.id===activeId&&<span style={{color:'#7c3aed',fontSize:14}}>✓</span>}
                <button onClick={()=>{onLogout(acc.id);setOpen(false);}}
                  style={{background:'none',color:'#71717a',fontSize:14,cursor:'pointer'}} title="登出此帳號">✕</button>
              </div>
            ))}
            <div style={{borderTop:'1px solid #27272b'}}>
              <button onClick={()=>{onAdd();setOpen(false);}}
                style={{width:'100%',padding:'10px 14px',background:'none',color:'#a78bfa',
                  textAlign:'left',fontSize:13,cursor:'pointer',display:'flex',alignItems:'center',gap:8}}>
                ＋ 新增帳號
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Duration Filter ──────────────────────────────────────────────────────────
function DurationFilter({minDuration,maxDuration,onChange}) {
  const presets=[
    {label:'全部',min:0,max:99999},
    {label:'10秒~3分',min:10,max:180},
    {label:'3~10分',min:180,max:600},
    {label:'10~30分',min:600,max:1800},
    {label:'30分以上',min:1800,max:99999},
  ];
  const isActive=(p)=>p.min===minDuration&&p.max===maxDuration;
  return (
    <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
      <span style={{fontSize:12,color:'#71717a',marginRight:2,whiteSpace:'nowrap'}}>時長篩選</span>
      {presets.map(p=>(
        <button key={p.label} onClick={()=>onChange(p.min,p.max)}
          style={{padding:'4px 10px',borderRadius:20,fontSize:12,cursor:'pointer',border:'1px solid',
            borderColor:isActive(p)?'#7c3aed':'#2e2e35',
            background:isActive(p)?'#7c3aed22':'transparent',
            color:isActive(p)?'#a78bfa':'#71717a',transition:'all 0.15s',whiteSpace:'nowrap'}}>
          {p.label}
        </button>
      ))}
      <div style={{display:'flex',alignItems:'center',gap:4,marginLeft:4}}>
        <input type="number" min={0} max={99999} value={minDuration}
          onChange={e=>onChange(Number(e.target.value),maxDuration)}
          style={{width:54,padding:'3px 6px',borderRadius:6,fontSize:12,
            background:'#1f1f23',border:'1px solid #2e2e35',color:'#f4f4f5',textAlign:'center'}}/>
        <span style={{color:'#52525b',fontSize:11}}>~</span>
        <input type="number" min={0} max={99999} value={maxDuration}
          onChange={e=>onChange(minDuration,Number(e.target.value))}
          style={{width:54,padding:'3px 6px',borderRadius:6,fontSize:12,
            background:'#1f1f23',border:'1px solid #2e2e35',color:'#f4f4f5',textAlign:'center'}}/>
        <span style={{color:'#52525b',fontSize:11}}>秒</span>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function Home() {
  const router = useRouter();

  // ── view ──
  // 'loading'      初始載入
  // 'login'        未登入
  // 'main'         主畫面（含掃描 / 有影片 / 無群組 等子狀態）
  const [view, setView]             = useState('loading');
  const [accounts, setAccounts]     = useState([]);
  const [activeId, setActiveId]     = useState(null);

  // ── allVideos：server 掃回的原始完整清單 ──────────────────────────────────
  // displayVideos 由 allVideos + client-side filter 算出，不再重掃
  const [allVideos, setAllVideos]   = useState([]);
  const [scanning, setScanning]     = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [scanDone, setScanDone]     = useState(true);

  // ── Display filters（全部 client-side，不觸發重掃）────────────────────────
  const [search, setSearch]               = useState('');
  const [minDuration, setMinDuration]     = useState(10);
  const [maxDuration, setMaxDuration]     = useState(180);
  const [videosPerGroup, setVideosPerGroup] = useState(50);
  const [days, setDays]                   = useState(7);

  // ── 其他 ──────────────────────────────────────────────────────────────────
  const [favIds, setFavIds]               = useState(new Set());
  const [selectedGroupIds, setSelectedGroupIds] = useState(null);
  const [toast, setToast]                 = useState('');

  const esRef           = useRef(null);
  const toastTimer      = useRef(null);
  const prevSelectedRef = useRef(null);
  const pendingRef      = useRef([]);       // 掃描期間累積，done 時 atomic replace

  // ── displayVideos：allVideos 套上所有 client-side filter ──────────────────
  const displayVideos = useMemo(() => {
    const now     = Math.floor(Date.now() / 1000);
    const cutoff  = days > 0 ? now - days * 86400 : 0;

    // Step 1：filter by date / duration / search
    let result = allVideos.filter(v => {
      if (cutoff > 0 && v.date < cutoff)                       return false;
      if (minDuration > 0 && v.duration < minDuration)         return false;
      if (maxDuration < 99999 && v.duration > maxDuration)     return false;
      if (search) {
        const q = search.toLowerCase();
        if (!`${v.title||''} ${v.chatTitle||''}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    // Step 2：per-group limit（allVideos 已按日期降冪排列）
    const groupCounts = new Map();
    result = result.filter(v => {
      const n = groupCounts.get(v.chatId) || 0;
      if (n >= videosPerGroup) return false;
      groupCounts.set(v.chatId, n + 1);
      return true;
    });

    return result;
  }, [allVideos, days, minDuration, maxDuration, search, videosPerGroup]);

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2000);
  };

  // ── doScan：掃描選定群組，永遠以最大量取回（200支/群，不限天數）────────
  // displayVideos 的 days / videosPerGroup 只做 client-side display filter
  const doScan = useCallback((accountId, overrideIds) => {
    clearCachedVideos();
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    pendingRef.current = [];
    setScanning(true);
    setScanDone(false);
    setScanStatus('連線中…');

    const accId = accountId || activeId;
    const ids   = overrideIds !== undefined ? overrideIds : selectedGroupIds;

    // 永遠以最大設定掃，display filter 再縮小
    const params = new URLSearchParams({
      accountId: accId,
      videosPerGroup: 200,
      days: 0,
      minDuration: 0,
      maxDuration: 99999,
    });

    if (ids && ids.length > 0) {
      // 模式 A：用已知群組的 accessHash 直接建 peer，跳過 getDialogs
      const knownGroups = getKnownGroups();
      const details = knownGroups.filter(g => ids.includes(g.chatId));
      if (details.length > 0) {
        const groupsInfo = details.map(g => [
          g.chatId,
          g.accessHash || '0',
          g.chatType || 'channel',
          encodeURIComponent(g.chatTitle || g.chatId),
        ].join(':')).join(',');
        params.set('groupsInfo', groupsInfo);
      } else {
        params.set('chatIds', ids.join(','));
      }
    }
    // ids === null → 不限群組（模式 B，掃前 30 個對話）

    const es = new EventSource(`/api/videos?${params}`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'total_chats') setScanStatus(`掃描 ${msg.count} 個群組中…`);
        if (msg.type === 'scanning')    setScanStatus(`掃描：${msg.chat}`);
        if (msg.type === 'video') {
          // 累積在 pendingRef，不動 allVideos，掃描期間舊清單繼續顯示
          const sorted = [...pendingRef.current, msg.video].sort((a,b) => b.date - a.date);
          pendingRef.current = sorted;
        }
        if (msg.type === 'done') {
          const final = pendingRef.current;
          setAllVideos(final);
          setScanning(false); setScanStatus(''); es.close();
          setScanDone(true);
          // 儲存快取（key = 選定的群組 ID JSON）
          saveCachedVideos(final, JSON.stringify(ids));
          // 更新已知群組影片數量
          const groupMap = new Map();
          final.forEach(v => {
            if (!groupMap.has(v.chatId))
              groupMap.set(v.chatId, { chatId: v.chatId, chatTitle: v.chatTitle, chatType: v.chatType, accessHash: v.accessHash, count: 0 });
            groupMap.get(v.chatId).count++;
          });
          if (groupMap.size > 0) {
            const existing = getKnownGroups();
            const existingMap = new Map(existing.map(g => [g.chatId, g]));
            groupMap.forEach((g, id) => {
              if (existingMap.has(id)) existingMap.get(id).count = g.count;
            });
            saveKnownGroups([...existingMap.values()].sort((a,b) => b.count - a.count));
          }
        }
        if (msg.type === 'error') {
          setScanning(false); setScanStatus(`錯誤：${msg.message}`); es.close(); setScanDone(true);
        }
      } catch {}
    };
    es.onerror = () => { setScanning(false); setScanStatus('連線中斷'); es.close(); setScanDone(true); };
  }, [activeId, selectedGroupIds]);

  // ── 掛載：載入帳號 + 群組設定 ──────────────────────────────────────────────
  useEffect(() => {
    const ids   = getSelectedGroupIds();
    const known = getKnownGroups();
    setSelectedGroupIds(ids);
    prevSelectedRef.current = ids;

    (async () => {
      try {
        const data = await api('/api/accounts');
        if (!data.accounts?.length) { setView('login'); return; }
        setAccounts(data.accounts);
        setActiveId(data.activeAccountId);

        // 尚未設定群組（第一次進入，或選了空清單）→ 顯示引導
        const hasGroups = known.length > 0 && (ids === null || ids.length > 0);
        if (!hasGroups) {
          setView('main'); // 主畫面會顯示「前往設定」引導
          return;
        }

        // 嘗試讀取快取（從影片頁返回時）
        const cached = getCachedVideos(JSON.stringify(ids));
        if (cached && cached.length > 0) {
          setAllVideos(cached);
          setScanDone(true);
          setView('main'); // 有快取，直接顯示（不觸發掃描）
        } else {
          setView('main_scan'); // 需要掃描
        }
      } catch {
        setView('login');
      }
    })();
  }, []); // eslint-disable-line

  // ── 掃描觸發：view='main_scan' 且帳號就緒時才掃 ─────────────────────────
  useEffect(() => {
    if (view === 'main_scan' && activeId) {
      const known = getKnownGroups();
      const ids   = selectedGroupIds;
      if (known.length > 0 && (ids === null || ids.length > 0)) {
        doScan(activeId, ids);
        setView('main');
      }
    }
  }, [view, activeId]); // eslint-disable-line

  // ── 回到首頁時（focus）偵測群組是否改變 → 若改變則重掃 ──────────────────
  useEffect(() => {
    const onFocus = () => {
      const newIds = getSelectedGroupIds();
      const prev   = prevSelectedRef.current;
      if (JSON.stringify(prev) !== JSON.stringify(newIds)) {
        clearCachedVideos();
        setSelectedGroupIds(newIds);
        prevSelectedRef.current = newIds;

        const known    = getKnownGroups();
        const isActive = view === 'main' || view === 'main_scan';
        if (isActive && activeId) {
          const hasGroups = known.length > 0 && (newIds === null || newIds.length > 0);
          if (hasGroups) {
            setAllVideos([]);
            doScan(activeId, newIds);
          } else {
            // 群組取消選擇 → 清空但不掃
            if (esRef.current) { esRef.current.close(); esRef.current = null; }
            setAllVideos([]);
            setScanning(false);
          }
        }
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [view, activeId, doScan]);

  // ── Display filter handlers（純 client-side，不呼叫 doScan）──────────────
  const handleDurationChange   = (minD, maxD) => { setMinDuration(minD); setMaxDuration(maxD); };
  const handleVPerGroupChange  = (v) => setVideosPerGroup(v);
  const handleDaysChange       = (d) => setDays(d);
  const handleSearch           = (val) => setSearch(val);

  // ── Account management ────────────────────────────────────────────────────
  async function handleSwitch(id) {
    clearCachedVideos(); setAllVideos([]);
    await api('/api/accounts?action=switch', { method: 'POST', body: { id } });
    setActiveId(id);
    setAccounts(prev => prev.map(a => ({ ...a, active: a.id === id })));
    doScan(id);
  }
  async function handleLogout(id) {
    clearCachedVideos(); setAllVideos([]);
    await api('/api/accounts?action=logout', { method: 'POST', body: { id } });
    const data = await api('/api/accounts');
    setAccounts(data.accounts || []);
    setActiveId(data.activeAccountId);
    if (!data.accounts?.length) setView('login');
    else doScan(data.activeAccountId);
  }
  function handleLoggedIn(account) {
    clearCachedVideos(); setAllVideos([]);
    setAccounts(prev => { const next = prev.filter(a => a.id !== account.id); return [...next, account]; });
    setActiveId(account.id);
    setView('main_scan');
  }

  // ── 播放影片 ──────────────────────────────────────────────────────────────
  function handlePlay(video) {
    addWatched(video);
    saveCachedVideos(allVideos, JSON.stringify(selectedGroupIds));
    savePlaylist(displayVideos);
    const p = new URLSearchParams({
      chatId: video.chatId, msgId: video.msgId,
      accessHash: video.accessHash||'', chatType: video.chatType||'',
      mimeType: video.mimeType||'video/mp4', accountId: video.accountId||'',
      title: video.title||'', chatTitle: video.chatTitle||'',
      date: video.date||0, duration: video.duration||0,
      fileSize: video.fileSize||0, hasThumbnail: video.hasThumbnail?'true':'false',
    });
    router.push(`/video?${p}`);
  }

  function handleLongPress(video) {
    const added = toggleFavorite(video);
    setFavIds(prev => { const next = new Set(prev); if (added) next.add(video.id); else next.delete(video.id); return next; });
    showToast(added ? '❤️ 已加入最愛' : '🤍 已從最愛移除');
  }

  // ── 初始化 favIds ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { setFavIds(new Set(JSON.parse(localStorage.getItem('tg_favorites')||'[]').map(v=>v.id))); } catch {}
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  const known         = getKnownGroups();
  const hasGroups     = known.length > 0 && (selectedGroupIds === null || (selectedGroupIds && selectedGroupIds.length > 0));
  const isFirstTime   = known.length === 0;  // 從未蒐集過群組
  const noSelection   = !isFirstTime && selectedGroupIds !== null && selectedGroupIds.length === 0;

  if (view === 'loading') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <Spinner size={32}/>
    </div>
  );

  if (view === 'login') return (
    <>
      <Head><title>Telegram 影片瀏覽器</title></Head>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:#0d0d0f;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;}
        input{width:100%;background:#27272b;border:1px solid #3f3f46;border-radius:8px;padding:10px 14px;color:#f4f4f5;font-size:15px;outline:none;}
        input:focus{border-color:#7c3aed;}
        button{border:none;background:none;font-family:inherit;}
        @keyframes spin{to{transform:rotate(360deg);}}
      `}</style>
      <LoginPage onLoggedIn={handleLoggedIn}/>
    </>
  );

  return (
    <>
      <Head>
        <title>Telegram 影片瀏覽器</title>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
      </Head>
      <style>{`
        *{box-sizing:border-box;margin:0;padding:0;}
        body{background:#0d0d0f;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;}
        input{width:100%;background:#27272b;border:1px solid #3f3f46;border-radius:8px;padding:10px 14px;color:#f4f4f5;font-size:15px;outline:none;}
        input:focus{border-color:#7c3aed;}
        button{border:none;background:none;font-family:inherit;}
        @keyframes spin{to{transform:rotate(360deg);}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}
        .vcard{animation:fadeIn 0.2s ease both;}
        .video-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;}
        @media(max-width:480px){.video-grid{grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;}}
        ::-webkit-scrollbar{width:5px;}
        ::-webkit-scrollbar-thumb{background:#2e2e35;border-radius:3px;}
      `}</style>

      {/* ── Header ── */}
      <header style={{position:'sticky',top:0,zIndex:50,background:'rgba(13,13,15,0.9)',
        backdropFilter:'blur(14px)',borderBottom:'1px solid #1f1f23',
        padding:'0 16px',display:'flex',alignItems:'center',gap:12,height:58}}>
        <div style={{display:'flex',flexDirection:'column',alignItems:'center',flexShrink:0}}>
          <span style={{fontSize:22,lineHeight:1}}>📺</span>
          <span style={{fontSize:9,color:'#52525b',letterSpacing:'0.02em'}}>v1.2</span>
        </div>
        {/* Search */}
        <div style={{flex:1,position:'relative',maxWidth:520}}>
          <input type="search" placeholder="搜尋影片標題或群組名稱…"
            value={search} onChange={e=>handleSearch(e.target.value)}
            style={{paddingLeft:38,borderRadius:20,background:'#18181b',fontSize:13}}/>
          <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',color:'#52525b',fontSize:15}}>🔍</span>
          {search&&(
            <button onClick={()=>handleSearch('')}
              style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',
                background:'none',color:'#52525b',fontSize:16,cursor:'pointer'}}>×</button>
          )}
        </div>
        <AccountSwitcher accounts={accounts} activeId={activeId}
          onSwitch={handleSwitch} onAdd={()=>setView('login')} onLogout={handleLogout}/>
      </header>

      {/* ── Toolbar ── */}
      <div style={{background:'#111113',borderBottom:'1px solid #1f1f23',
        padding:'10px 16px',display:'flex',flexWrap:'wrap',gap:12,alignItems:'center'}}>

        {/* 掃描狀態 / 影片數 */}
        <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0,flex:1}}>
          {scanning&&<Spinner size={13}/>}
          <span style={{color:'#71717a',fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
            {scanning ? scanStatus
              : allVideos.length > 0
                ? `共 ${allVideos.length} 支（顯示 ${displayVideos.length} 支）`
                : '尚無影片'}
          </span>
          {!scanning && selectedGroupIds !== null && selectedGroupIds.length > 0 && (
            <span style={{fontSize:10,background:'#7c3aed22',color:'#a78bfa',borderRadius:10,padding:'2px 7px',flexShrink:0,whiteSpace:'nowrap'}}>
              {selectedGroupIds.length} 群組
            </span>
          )}
        </div>

        {/* 時長篩選 */}
        <DurationFilter minDuration={minDuration} maxDuration={maxDuration} onChange={handleDurationChange}/>

        {/* 群組影片上限 */}
        <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#71717a',flexShrink:0}}>
          <span>群組影片</span>
          <select value={videosPerGroup} onChange={e=>handleVPerGroupChange(Number(e.target.value))}
            style={{background:'#27272b',color:'#f4f4f5',border:'1px solid #3f3f46',borderRadius:6,padding:'3px 7px',fontSize:12}}>
            {[10,20,50,100,200].map(n=><option key={n} value={n}>{n} 支</option>)}
          </select>
        </div>

        {/* 天數 */}
        <div style={{display:'flex',alignItems:'center',gap:6,fontSize:12,color:'#71717a',flexShrink:0}}>
          <span>天數</span>
          <select value={days} onChange={e=>handleDaysChange(Number(e.target.value))}
            style={{background:'#27272b',color:'#f4f4f5',border:'1px solid #3f3f46',borderRadius:6,padding:'3px 7px',fontSize:12}}>
            {[1,3,7,14,30,90].map(d=><option key={d} value={d}>{d} 天</option>)}
            <option value={0}>不限</option>
          </select>
        </div>

        {/* 重新掃描按鈕 */}
        <button
          onClick={() => { setAllVideos([]); doScan(activeId, selectedGroupIds); }}
          disabled={scanning || !hasGroups}
          style={{flexShrink:0,display:'flex',alignItems:'center',gap:5,
            padding:'5px 13px',borderRadius:7,fontSize:12,fontWeight:600,
            cursor:(scanning||!hasGroups)?'not-allowed':'pointer',
            opacity:(scanning||!hasGroups)?0.45:1,
            background:'#7c3aed22',color:'#a78bfa',border:'1px solid #7c3aed55',
            transition:'all 0.15s'}}>
          {scanning?<Spinner size={12}/>:'↻'} 重新掃描
        </button>
      </div>

      {/* ── 主內容 ── */}
      <main style={{padding:'16px',paddingBottom:80,minHeight:'calc(100vh - 120px)'}}>

        {/* ① 第一次進入：尚未蒐集群組 */}
        {isFirstTime && !scanning && (
          <div style={{textAlign:'center',padding:'80px 20px',color:'#52525b'}}>
            <div style={{fontSize:56,marginBottom:16}}>📡</div>
            <p style={{fontSize:18,fontWeight:600,color:'#3f3f46'}}>尚未設定群組</p>
            <p style={{marginTop:8,fontSize:13}}>請先到設定頁蒐集並選擇要顯示的群組</p>
            <Link href="/settings" style={{display:'inline-block',marginTop:24,padding:'10px 24px',
              background:'#7c3aed',color:'#fff',borderRadius:8,fontSize:14,fontWeight:600,textDecoration:'none'}}>
              ⚙️ 前往設定
            </Link>
          </div>
        )}

        {/* ② 有群組資料但未選任何群組 */}
        {noSelection && !scanning && (
          <div style={{textAlign:'center',padding:'80px 20px',color:'#52525b'}}>
            <div style={{fontSize:56,marginBottom:16}}>📋</div>
            <p style={{fontSize:18,fontWeight:600,color:'#3f3f46'}}>尚未選擇任何群組</p>
            <p style={{marginTop:8,fontSize:13}}>請到設定頁勾選要顯示的群組</p>
            <Link href="/settings" style={{display:'inline-block',marginTop:24,padding:'10px 24px',
              background:'#7c3aed',color:'#fff',borderRadius:8,fontSize:14,fontWeight:600,textDecoration:'none'}}>
              ⚙️ 前往設定
            </Link>
          </div>
        )}

        {/* ③ 有群組、掃描完畢、但 allVideos 為空 */}
        {hasGroups && !scanning && allVideos.length === 0 && (
          <div style={{textAlign:'center',padding:'80px 20px',color:'#52525b'}}>
            <div style={{fontSize:56,marginBottom:16}}>🎬</div>
            <p style={{fontSize:18,fontWeight:600,color:'#3f3f46'}}>尚未找到影片</p>
            <p style={{marginTop:8,fontSize:13}}>點擊「重新掃描」或調整設定</p>
          </div>
        )}

        {/* ④ displayVideos 為空但 allVideos 有資料（filter 太嚴格） */}
        {hasGroups && !scanning && allVideos.length > 0 && displayVideos.length === 0 && (
          <div style={{textAlign:'center',padding:'80px 20px',color:'#52525b'}}>
            <div style={{fontSize:56,marginBottom:16}}>🔍</div>
            <p style={{fontSize:18,fontWeight:600,color:'#3f3f46'}}>
              {search ? '找不到符合的影片' : '目前篩選條件無結果'}
            </p>
            <p style={{marginTop:8,fontSize:13}}>
              {search ? '請嘗試不同關鍵字' : '試試放寬時長範圍或增加天數'}
            </p>
          </div>
        )}

        {/* ⑤ 影片格狀清單 */}
        <div className="video-grid">
          {displayVideos.map((v,i) => (
            <div key={v.id} className="vcard" style={{animationDelay:`${Math.min(i*0.025,0.4)}s`}}>
              <VideoCard video={v} onPlay={handlePlay} onLongPress={handleLongPress}
                isWatched={false} isFav={favIds.has(v.id)} thumbReady={scanDone}/>
            </div>
          ))}
        </div>
      </main>

      <Toast message={toast}/>
      <NavBar active="home"/>
    </>
  );
}
