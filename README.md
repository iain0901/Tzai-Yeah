# 載耶小屋 2026 · Tzai-Yeah

載物書院耶誕晚會的 NFC 小卡網站，可部署在自己的伺服器。使用 Next.js、Node.js 與本機 SQLite；網站執行、資料儲存及帳號登入不需要 Sites、Cloudflare 或 OpenAI 服務。

- 手機直式、固定畫面的 App 操作方式，搭配耶誕動畫、活動資訊與直式預告片。
- 每張 NFC 卡有獨立的 `/t/卡片代碼` 網址，串接活動前、中、後的內容。
- 個人聖誕樹遊戲：小卡 token 統一識別，以卡號作預設名稱，可改暱稱、搖手機或點按長高、查看排行榜；無 token 不建立訪客玩家。
- 工作人員後台：保留管理員登入；總覽最上方顯示目前階段，三個按鈕切換活動前／中／後，並提示儲存結果。另可管理卡片、名單、分組、報到、影片與回顧。
- 已啟用且配對參加者的小卡，可憑原本的專屬連結編輯個人名稱、簡介與 HTTPS 連結，無須登入或私人認領碼；名稱留白則使用卡號。

專屬網址內的 token 隨機產生，不能由系統卡號推算；持有完整連結即能操作該卡，請只交給本人收藏。相同網址在不同手機延續同一棵小樹，不需另建訪客身分。個人外部連結只在主動點按時開啟，活動後主畫面仍保留紀念畫面與外部相簿入口。

發卡按家別整理：系統卡號跨家連續編號，卡套上的家內編號則每家從 `1` 開始，透過工作人員對照表綁定姓名。家內編號可在後台參加者名單中維護及匯出；逐張感應的寫卡程式尚未實作；含姓名的名單與專屬網址清單留在本機或私人資料空間。詳見[按家編號與整批發卡](docs/OPERATIONS.md#按家編號與整批發卡)。

## 用 Docker 啟動

需要 Docker Engine／Docker Desktop 與 Docker Compose v2。首次啟動會建立 SQLite 資料庫、隨機工作階段密鑰、管理員帳號和 150 張卡片。

```sh
git clone https://github.com/iain0901/Tzai-Yeah.git
cd Tzai-Yeah
docker compose up -d --build
docker compose exec app cat /app/secrets/admin-login.txt
```

在同一台電腦開啟 <http://localhost:3000>，使用上一步檔案內的帳密登入 `/admin`。帳密只放在自己的持久化 `secrets` 空間，請私人保管。

正式部署前，複製 `.env.example` 為 `.env`，將 `PUBLIC_ORIGIN` 設為自己的 HTTPS 網址，再用 Caddy 或既有反向代理連到 `127.0.0.1:3000`。完整步驟見 [自架與備份手冊](docs/SELF-HOSTING.md)。

**若要沿用已產生的 NFC 代碼，請先依手冊匯入卡片 CSV，再第一次啟動。** 舊站網域不會自動變成自己的網域；已寫入舊網址的卡片仍需處理網址轉移。

## 直接使用 Node.js

需要 Node.js 24 以上，建議使用 24 LTS。於專案目錄執行：

```sh
cp .env.example .env
npm ci
npm run setup
npm run build
npm start
```

預設資料庫是 `data/tzai.sqlite`；首次管理員帳密在 `secrets/admin-login.txt`。開發時使用 `npm run dev`。Windows PowerShell 複製檔案時使用 `Copy-Item .env.example .env`。

## 資料與部署

Docker 將資料存入 `tzai-yeah_data`、`tzai-yeah_secrets` named volumes，重建容器會保留資料。直接執行 Node 則使用專案內的 `data/`、`secrets/`。這些目錄、`.env`、NFC 網址清單及備份都不會提交到 GitHub，也不會打包進 Docker 映像。

不要使用 `docker compose down -v` 清理正式站，該指令會刪除持久化資料。更新、完整備份、還原、HTTPS、密鑰與卡片遷移方式請見 [SELF-HOSTING.md](docs/SELF-HOSTING.md)。推送 GitHub 只更新原始碼，不會自動更新任何已部署網站。

YouTube 預告與外部相簿是可選內容；未設定影片時使用本地活動資訊動畫。音樂由第一次使用者操作後播放；手機感應器還需要 HTTPS 與瀏覽器授權。

## 文件

- [自架與備份手冊](docs/SELF-HOSTING.md)：Docker、Node、網域、資料、私密設定、升級。
- [工作人員操作手冊](docs/OPERATIONS.md)：NFC 發卡、名單、人工分組、報到與活動階段。
- [載耶小屋與聖誕樹玩法](docs/CHRISTMAS-HOUSE.md)：小屋入口、遊戲與音樂。
- [發卡前檢查表](tests/acceptance-checklist.md)：現場流程與手機實測。
- [自架版驗證紀錄](docs/SELF-HOST-VALIDATION.md)：本次測試結果與驗證範圍。

本次自架部署方式以 `docs/SELF-HOSTING.md` 為準；舊版驗收紀錄記錄的是當時的環境，不能視為這次 Docker 或正式伺服器的測試結果。
