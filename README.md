# 📺 Telegram 影片瀏覽器

響應式網頁應用程式，透過 Telegram API 登入後，自動列出所有加入群組的影片（由新到舊）。

## 功能特色

- ✅ 多帳號切換（支援不同 Telegram 帳號）
- ✅ 兩步驟驗證（2FA）支援
- ✅ 從所有群組／頻道掃描影片，由新到舊排列
- ✅ 影片縮圖預覽
- ✅ 搜尋功能（標題 + 群組名稱）
- ✅ 可調整卡片大小（160px – 400px）
- ✅ 影片直接串流播放，支援拖拉進度條
- ✅ 手機與電腦自動適配

---

## 部署步驟

### 1. 取得 Telegram API 憑證

前往 [my.telegram.org](https://my.telegram.org) → 登入 → **API Development Tools** → 建立應用程式，取得：
- **API ID**（數字）
- **API Hash**（字串）

### 2. 上傳到 GitHub

```bash
git init
git add .
git commit -m "init: Telegram Video Browser"
git branch -M main
git remote add origin https://github.com/你的帳號/telegram-video-browser.git
git push -u origin main
```

### 3. 部署到 Vercel

1. 前往 [vercel.com](https://vercel.com)，登入並點 **Add New Project**
2. 選擇你剛才的 GitHub repository
3. Framework Preset 選 **Next.js**
4. 點 **Deploy**（無需設定環境變數）

### 4. 使用

部署完成後，開啟 Vercel 網址：
1. 輸入 API ID 和 API Hash
2. 輸入手機號碼（含國碼，例如 `+886912345678`）
3. 輸入 Telegram 發送的驗證碼
4. 若有 2FA 則輸入密碼
5. 登入成功後自動掃描群組影片

---

## 本地開發

```bash
npm install
npm run dev
```

開啟 http://localhost:3000

---

## 注意事項

| 項目 | 說明 |
|------|------|
| **Vercel 方案** | Hobby 限 10 秒，Pro 限 60 秒，Enterprise 限 300 秒。掃描大量群組建議 Pro 以上 |
| **首次播放** | 影片需先下載至伺服器 `/tmp`，之後（同 instance 期間）可即時串流 |
| **隱私** | Session string 存在瀏覽器 Cookie（未加密），請勿在公共電腦使用 |
| **Cookie 限制** | 最多支援約 4-5 個帳號（受 4KB Cookie 上限限制） |
| **群組掃描上限** | 預設掃描 30 個群組，可在 UI 調整至最多 100 個 |

---

## 技術架構

- **Frontend**: Next.js 14 (Pages Router) + React 18
- **Backend**: Next.js API Routes (Serverless Functions)
- **Telegram**: GramJS (MTProto 協議)
- **Session 管理**: Cookie-based（無需資料庫）
- **影片快取**: Vercel `/tmp` 目錄（ephemeral）

```
pages/
  index.js                  ← 主 UI（登入 + 影片格狀瀏覽）
  api/
    auth/
      send-code.js          ← 發送 OTP
      verify-code.js        ← 驗證碼登入
      verify-2fa.js         ← 兩步驟驗證
    accounts.js             ← 帳號管理（列表 / 切換 / 登出）
    videos.js               ← SSE 串流影片列表
    thumb.js                ← 縮圖代理（瀏覽器快取 24hr）
    stream.js               ← 影片串流（支援 Range Request）
    stream-progress.js      ← 下載進度 SSE
lib/
  telegram.js               ← GramJS 工具函式
```
