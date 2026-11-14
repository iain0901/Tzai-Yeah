# 載耶 2026：手機互動小世界

這一版依使用者「像 App、不需要往下滑、會自己動、按一下有回應」的要求，將既有活動頁改為固定視窗與底部分頁。原始主視覺、拼圖愛心、實體卡面與暖色手繪質感繼續沿用。

## 設計參考與素材來源

本次新增的參考圖與獨立角色素材由內建 image_gen 模型生成。以下 PNG 是原圖直接複製保存，沒有重繪或改字；參考圖用來確認構圖與質感，網頁仍使用真正可操作的按鈕、可選取文字與活動資料。

| 保存檔案 | 用途 | 生成來源 |
| --- | --- | --- |
| `app-home-reference.png` | 單一手機畫面首頁：浮動愛心、角色、邀請入口與底部分頁 | `exec-e613215f-84bd-4633-b054-a3b3b162f871.png` |
| `app-info-reference.png` | 活動分頁：奶油色活動票券、日期、時間與地點 | `exec-5e2b54a2-b38b-4794-b2cd-6bfa799330f9.png` |
| `gingerbread-wave-source.png` | 揮手的紅圍巾薑餅人，透明背景 | `exec-8a3577d9-18dd-4b1b-ae9c-3c850d7e74c3.png` |
| `christmas-gift-source.png` | 金色緞帶、愛心吊牌的紅色禮盒，透明背景 | `exec-99d0d852-20bc-4995-90c3-160c7db54923.png` |

原始生成檔位於 `C:/Users/USER/.codex/generated_images/01a1d8fb-5d08-7f12-8113-d6f8f2003f83/`。既有 `heart-source.png` 與 `original-poster.jpg` 的來源見 `README.md`。

### 網頁素材

- `public/assets/gingerbread-wave.webp`、`christmas-gift.webp`：由對應 PNG 使用 sharp 製作。只裁去透明邊緣（threshold 1、留 12px 邊距），等比例縮至 380 × 380px 以內，WebP quality 86、alphaQuality 100、effort 6；保留 alpha 透明背景與原始畫風。
- `public/assets/pass-back.webp`：由使用者的實體卡背圖 `design/card-back.jpg` 等比例縮至寬 1200px，WebP quality 85、effort 6。卡面上的 030 是 30 級識別，不當作持卡者流水號。
- `public/assets/heart.webp`：沿用既有透明拼圖愛心，首頁的核心互動物件。
- 兩張完整 App 參考圖僅保存在 `design/`，不打包成整頁背景，不增加手機首頁下載量。

## 視覺方向

以森林綠為舞台、奶油白為文字與票券、暖黃為光點與緞帶、珊瑚紅與粉色為拼圖及互動重點。角色保留手繪水粉筆觸、紙張顆粒與不規則深棕輪廓。標題採有溫度的襯線字體，功能資訊保持清楚。主要動作位於拇指容易點按的位置，底部分頁固定；場景插畫跟著剩餘高度縮放，小螢幕也不靠向下捲動尋找入口。

參考圖中的日期、時間與地點是排版示意。實作以活動設定資料為準，不從圖片辨識文字作為正式資料來源。

## 動態與互動規劃

`components/event/AnimatedWorld.tsx` 搭配 `animated-world.css` 負責首頁獨立的玩具場景：

| 元素 | 持續動態 | 點按回應 |
| --- | --- | --- |
| 拼圖愛心 | 5.6 秒輕浮與小角度轉動 | 彈簧縮放、金色星星散開，循環顯示 4 句暖心短句 |
| 薑餅人 | 3.4 秒輕搖 | 跳躍與左右招手感的擺動，送出問候 |
| 禮物 | 5.2 秒循環，間歇輕晃 | 彈起並於 300ms 後打開邀請 |
| 三片拼圖 | 21／28／34 秒不同方向環繞 | 純裝飾，不攔截點按 |
| 星星與亮點 | 錯開時間閃爍、沿軌道移動 | 主互動另外觸發短暫星星散落 |
| 金色軌跡與暖光 | 8／10 秒緩慢擺動與呼吸 | 純裝飾 |

持續動態以 CSS transform／opacity 執行，不透過每幀 React 更新。點按的有限動畫由本地狀態重新觸發；計時器在卸載時清理。父層透過 `onFeedback` 顯示短句，場景不額外堆疊文字或固定按鈕。

元件 API：`{ onInvite, onFeedback?, soundEnabled = false, compact = false }`。使用有高度限制且 `min-height: 0` 的容器；場景 `height: 100%`、`aspect-ratio: 1`、`max-height: 100%`，避免撐高整頁。

### 觸控、音效與減少動態

所有角色都是可用鍵盤啟動的原生按鈕，具備繁體中文可存取名稱與焦點標示。點按區至少 44px。裝飾圖形不接收滑鼠／觸控事件。

音效預設關閉，僅在父層已啟用音效且使用者點按時，以 WebAudio 播放短而輕的雙音鈴聲；沒有自動播放背景音樂。若系統設定 `prefers-reduced-motion: reduce`，停止所有循環／點按動畫與星星粒子，保留按鈕及文字回應，禮物直接開啟邀請。
