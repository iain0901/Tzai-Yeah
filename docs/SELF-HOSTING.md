# 載耶小屋｜自架與資料維護

這個版本把網站、登入與資料庫放在自己的伺服器。前台不需登入，管理後台與個人頁編輯使用本機帳號驗證。資料庫使用 SQLite，第一次啟動會依 `drizzle/` 內的遷移建立資料表；後續啟動只套用尚未執行的遷移，不會重設名單或遊戲紀錄。

## 1. Docker Compose

需要 Docker Engine／Docker Desktop 與 Compose v2，不需要在主機安裝 Node.js。以下指令在專案根目錄執行。

```sh
cp .env.example .env
docker compose up -d --build
docker compose ps
```

Windows PowerShell 的複製指令是 `Copy-Item .env.example .env`。首次測試可保留 `PUBLIC_ORIGIN=http://localhost:3000`，並在該主機開啟 `http://localhost:3000`。

映像使用 Node.js 24 與 Next.js standalone，執行時為非 root 使用者。容器啟動會自動初始化空白實例：建立 SQLite、套用遷移、產生工作階段密鑰及第一位管理員，並在沒有卡片時預設建立 150 張專屬卡片。

取得管理員帳密：

```sh
docker compose exec app cat /app/secrets/admin-login.txt
```

在 `/login` 或 `/admin` 登入。這個檔案包含真正的管理員密碼，請只在自己的終端機查看並私人保存。重啟與更新會沿用既有帳號、密鑰及卡片，不會重新產生一批。

檢查執行狀態：

```sh
docker compose logs --tail=100 app
docker compose ps
```

健康檢查會讀取 `/api/health`，確認網站與 SQLite 可用。若顯示 unhealthy，先看錯誤紀錄與檔案權限，再處理設定。

### Docker 的持久化空間

| 空間 | 容器位置 | 內容 |
| --- | --- | --- |
| `tzai-yeah_data` | `/app/data` | SQLite、活動、卡片、名單、樹高、排行榜、帳號與工作階段 |
| `tzai-yeah_secrets` | `/app/secrets` | 工作階段密鑰、首次管理員帳密 |

這兩個 named volumes 由 Docker 管理，會跨容器重建保存。它們不在 GitHub，也不在映像內。`docker compose down` 保留資料；**`docker compose down -v` 會刪除資料，正式站請勿執行**。更改 Compose 專案名稱會指向不同的 volumes，看起來像空白新站；本專案固定名稱為 `tzai-yeah`。

## 2. 正式網域與 HTTPS

先把自己的網域 DNS 指向伺服器，再設定 `.env`，例如：

```dotenv
PUBLIC_ORIGIN=https://party.example.com
TRUST_PROXY=true
```

`PUBLIC_ORIGIN` 是產生 NFC 網址與驗證請求來源使用的正式網址；請填完整的來源網址，不加路徑。此範例由可信任的 Caddy 代理，網站連接埠只綁定主機 loopback，因此可設定 `TRUST_PROXY=true`，讓頻率限制依真正的訪客 IP 計算。若直接公開 Node 連接埠，保留 `TRUST_PROXY=false`。若變更設定，重新建立容器使環境變數更新：

```sh
docker compose up -d
```

Compose 預設只對主機 `127.0.0.1:3000` 開放服務，由同一台主機的 Caddy 提供公開 HTTPS。把 `deploy/Caddyfile.example` 的 `party.example.com` 改成自己的網域，放入現有 Caddy 設定：

```caddyfile
party.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

驗證設定後重新載入 Caddy：

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

公開 DNS、連入的 80／443 連接埠及伺服器對外連線需可用，Caddy 才能自動申請與更新憑證。Caddy 的安裝依主機系統處理，範例假設 Caddy 安裝在主機上。若你的反向代理也在容器中，請將其加入相同 Docker 網路，代理至 `app:3000`；代理容器內的 `127.0.0.1` 並不是網站容器。

首次正式部署請用真正手機開啟 HTTPS 網址，再測試登入、NFC 路徑、搖手機與音樂。iPhone 需要使用者按下按鈕授權動作感測；不支援或未授權時仍可點按讓樹長大。音樂受瀏覽器播放規則限制，需要第一次點按才會開始。

預設 `BIND_ADDRESS=127.0.0.1`。若確實需要區域網路直接測試，可在 `.env` 設 `BIND_ADDRESS=0.0.0.0`，並將 `PUBLIC_ORIGIN` 改為手機實際開啟的來源網址。一般 HTTP 區網網址不能完整測試手機感測器，正式站仍使用 HTTPS。

## 3. 直接執行 Node.js

需要 Node.js 24 以上，建議使用 24 LTS。資料庫直接使用 Node 內建 `node:sqlite`，不需要另外架 PostgreSQL、MySQL 或 Redis。

```sh
cp .env.example .env
npm ci
npm run setup
npm run build
npm start
```

所有指令從專案根目錄執行，`.env` 會由自架腳本載入。先依實際用途調整 `PUBLIC_ORIGIN`。預設私密檔案是 `secrets/session-secret` 與 `secrets/admin-login.txt`，資料庫是 `data/tzai.sqlite`。Windows 可以直接用上述 Node 指令，複製 `.env` 時改用 `Copy-Item`。

開發時使用 `npm run dev`；正式服務使用 `npm run build` 後的 `npm start`，並交由自己的 systemd、PM2 或既有程序管理工具保持運作。反向代理設定與 Docker 方式相同。Node 程序需有資料與私密目錄的讀寫權限。

## 4. 設定與私密資料

| 設定 | 用途 |
| --- | --- |
| `PUBLIC_ORIGIN` | 正式來源網址，例如 `https://party.example.com` |
| `DATABASE_PATH` | SQLite 檔案位置；直接 Node 預設 `./data/tzai.sqlite` |
| `SESSION_SECRET_FILE` | 隨機工作階段密鑰檔案位置 |
| `SECRETS_DIR` | 首次管理員帳密等私密檔案的目錄 |
| `SESSION_SECRET` | 選擇直接由環境變數供應密鑰時使用；請用隨機 64 位十六進位字串 |
| `INIT_CARD_COUNT` | 空白資料庫首次建立卡片數，預設 150 |
| `ADMIN_EMAIL`／`ADMIN_NAME` | 首次建立管理員的電子郵件與名稱；修改設定不會更動既有帳號 |
| `ADMIN_PASSWORD` | 選擇自訂首次管理員密碼時使用，12～128 字元；留空則產生隨機密碼 |
| `ALLOW_REGISTRATION` | 是否允許持卡者自行註冊一般帳號，預設 `true` |
| `TRUST_PROXY` | 是否信任反向代理提供的訪客 IP；只在服務確實位於可信代理後方時啟用 |
| `PORT` | 對外主機連接埠，預設 3000；Compose 內部仍是 3000 |
| `BIND_ADDRESS` | Compose 主機綁定位址，預設 `127.0.0.1` |

Compose 固定將資料庫與秘密路徑設在持久化 volumes 內；`.env` 中供直接 Node 使用的相對路徑不會覆蓋容器路徑。不要把密鑰放進 `NEXT_PUBLIC_*`，也不要把 `.env`、`secrets/`、資料庫或 NFC CSV 加進版控。

這套系統使用的是伺服器登入密鑰與隨機卡片代碼，沒有要求區塊鏈錢包私鑰。一般人知道卡片網址只能取得該卡允許公開的內容；個人頁編輯仍須登入並完成私人認領碼驗證，後台則需要管理員角色。

新註冊帳號不會自動成為管理員。舊版 Sites 的 ChatGPT 身分標頭、`ADMIN_EMAILS` 與模擬登入不作為此版本的授權依據。

### 管理員密碼

登入後可前往 `/login` 變更密碼。`admin-login.txt` 只是首次建立時的紀錄，不會跟著更新；變更完成後，請私人保管自己的新密碼。

若忘記密碼，可以在自己的伺服器執行重設：

```sh
# Docker
docker compose exec app node scripts/self-host/reset-admin.mjs admin@tzai.local

# 直接 Node
npm run admin:reset -- admin@tzai.local
```

把電子郵件換成實際管理員帳號。工具會將隨機新密碼寫入 `secrets/admin-reset-時間戳.txt` 並只顯示檔案位置；請在自己的終端機查看該檔案。重設會使此帳號的既有登入失效。

### 一般會員忘記密碼

主辦單位確認本人身分後，可在自己的伺服器替已啟用的一般會員重設密碼。必須提供該會員註冊時使用的電子郵件：

```sh
# Docker
docker compose exec app node scripts/self-host/reset-account.mjs member@example.com

# 直接 Node
npm run account:reset -- member@example.com
```

工具會將隨機新密碼寫入 `secrets/account-reset-時間戳.txt`，終端機只顯示檔案位置。請私下把新密碼交給本人，並請本人登入 `/login` 變更密碼。重設會結束該會員在所有裝置的登入；既有小卡認領與個人資料保持不變。此工具不會解除帳號停用，也不會更動管理員密碼。

## 5. 沿用既有 NFC 卡片代碼

新空白站可直接使用自動產生的 150 張卡片。若先前已經匯出另一個站的專屬網址，應在首次建立卡片前匯入原始 CSV，以保留每張卡的流水號與 48 位十六進位代碼。

從舊後台匯出的「NFC 網址清單」包含 `卡套流水號`、`NFC網址` 等欄位。將檔案放在專案的私人 `imports/` 目錄，例如 `imports/cards.csv`，不要提交 GitHub。這個匯入只搬卡片辨識資料，不會自動搬移舊站的帳號、參加者、分組或遊戲紀錄。

直接 Node，先匯入再啟動：

```sh
npm ci
npm run cards:import -- ./imports/cards.csv
npm run setup
npm run build
npm start
```

Docker，第一次 `up` 前執行以下 Linux shell 指令：

```sh
docker compose build
docker compose run --rm --no-deps \
  --volume "$PWD/imports/cards.csv:/app/import/cards.csv:ro" \
  --env NFC_IMPORT_FILE=/app/import/cards.csv \
  app node scripts/self-host/setup.mjs
docker compose up -d
```

PowerShell 可將反斜線續行改為反引號，或將指令合併成一行。掛載時使用 CSV 的絕對路徑。先確認檔案存在，避免 Docker 把不存在的來源建立成目錄。

匯入後登入新後台重新匯出網址清單，確認網址使用你的 `PUBLIC_ORIGIN`，並抽查卡套流水號與原始代碼一致。若新站已經建立不同的一批卡片，請先保留備份並檢查匯入衝突；不要直接刪除正式資料庫重新來過。

也可以從終端機匯出卡片清單至私人檔案：

```sh
# 直接 Node
npm run cards:export -- ./secrets/nfc-cards.csv

# Docker，接著複製到主機的私人目錄
docker compose exec app node scripts/self-host/cards.mjs export /app/secrets/nfc-cards.csv
docker compose cp app:/app/secrets/nfc-cards.csv ./imports/nfc-cards.csv
```

主機的 `imports/` 目錄請先建立。後台匯出的清單可包含已綁定的姓名與家別；CLI 匯出用途是卡片代碼與網址，這兩個欄位留空。CSV 匯入有衝突時整批取消，不會覆寫既有代碼。

**保留代碼不代表舊網域會自動轉址。** 寫在卡片裡的完整網址仍指向原網域。若卡片尚未寫入，就直接寫入新站匯出的網址；若已寫入 Sites 網址，需要重新寫卡，或在仍能控制的舊服務上另設轉址。這份程式不能控制 `chatgpt.site` 的 DNS 或替舊站建立轉址。

## 6. 備份與還原

完整備份需包含 SQLite 的一致快照、`secrets/` 與自己保管的 `.env`。NFC CSV、名單匯出與排行榜不是完整資料庫備份。SQLite 使用 WAL，請勿在運作中直接複製單一 `tzai.sqlite` 檔案。

### Docker 備份

網站可繼續運作，透過 SQLite 備份 API 建立快照，再把快照與秘密複製到主機：

```sh
mkdir -p backups
docker compose exec app node scripts/self-host/db-backup.mjs --output /app/data/backup-2026-11-21.sqlite
docker compose cp app:/app/data/backup-2026-11-21.sqlite ./backups/backup-2026-11-21.sqlite
docker compose cp app:/app/secrets ./backups/secrets
cp .env ./backups/deployment.env
```

請使用不同的日期／時間檔名；如果沒有建立 `.env`，不需複製它。`backups/secrets` 含登入密鑰與管理員帳密，整份備份必須放在私人儲存空間，不能公開分享。定期保留一份在伺服器以外的位置。

### Docker 還原

以下範例將主機上的備份掛載進暫時容器，資料寫回原本的 named volume。先停止網站，還原完成才重新啟動：

```sh
docker compose stop app
docker compose run --rm --no-deps \
  --volume "$PWD/backups/backup-2026-11-21.sqlite:/app/restore.sqlite:ro" \
  app node scripts/self-host/db-restore.mjs \
  --input /app/restore.sqlite --confirm-stopped --force
docker compose up -d
```

`--force` 允許替換既有資料庫；工具會先備份原有資料。`--confirm-stopped` 是你已停止所有網站程序的確認，不能拿來略過實際停機。還原到新的伺服器時，也要恢復 `.env` 與 `secrets/`，並確保容器內 UID/GID 1000（node）有讀寫權限。若只有 SQLite 還原而使用新密鑰，舊登入工作階段會失效，使用者需重新登入。

新主機先建置映像，將私人備份的 `deployment.env` 複製為 `.env` 並核對網址。首次啟動前可用以下指令恢復秘密，接著執行上面的資料庫還原指令：

```sh
docker compose build
docker compose run --rm --no-deps --user root \
  --volume "$PWD/backups/secrets:/restore-secrets:ro" \
  app sh -c 'cp -a /restore-secrets/. /app/secrets/ && chown -R node:node /app/secrets && chmod 700 /app/secrets && chmod 600 /app/secrets/*'
```

只有這次檔案恢復以 root 設定擁有者，正常網站仍以 node 使用者執行。如果還原意外中斷留下 `restore.lock`，先確認還原程序已結束，再依錯誤訊息處理鎖定檔；不要在另一次還原仍執行時移除它。

### 直接 Node 備份與還原

備份時可保持網站運作：

```sh
npm run db:backup -- --output backups/backup-2026-11-21.sqlite
```

另將 `secrets/` 與 `.env` 複製到同一批私人備份。還原前先停止自己啟動的 Node／systemd／PM2 網站程序：

```sh
npm run db:restore -- --input backups/backup-2026-11-21.sqlite --confirm-stopped --force
npm start
```

還原後核對登入、卡片、名單、分組與排行榜。要搬到新主機，先以相同版本程式還原並測試，再另行更新。

## 7. 更新程式

先完成資料與私密檔案備份，再更新原始碼。Docker：

```sh
git pull --ff-only
docker compose up -d --build
docker compose ps
```

直接 Node：停止目前網站程序，執行：

```sh
git pull --ff-only
npm ci
npm run build
npm start
```

啟動時自動套用未執行的遷移；既有資料和管理員會保留。資料庫可能已更新結構，降版前請檢查遷移相容性，必要時還原更新前的完整備份。GitHub push 不會自動替你的伺服器執行上述步驟，也不會更新原本的 Sites 網站。

## 8. 部署驗證

- 未登入的手機可以開啟首頁及有效卡片網址。
- 未登入的訪客不能取得 `/api/admin` 的管理資料。
- 管理員能登入後台，修改活動資訊後重新整理仍保留。
- 重啟容器後卡片、樹高、名單與帳號仍在。
- 正式 NFC 清單全部使用自己的 HTTPS 網域。
- 搖手機與點按皆可操作；排行榜會反映已儲存進度。
- 實際執行一次備份及測試還原，再開始正式發卡。

開發環境未提供 Docker daemon，因此 Dockerfile 與 Compose 僅進行靜態檢查；實際映像建置及伺服器環境仍需在有 Docker 的主機執行。Node 執行與網站功能的驗證結果以本次交付紀錄為準。

## 參考

- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Docker Compose 環境變數](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)
- [Caddy 反向代理與自動 HTTPS](https://caddyserver.com/docs/quick-starts/reverse-proxy)
