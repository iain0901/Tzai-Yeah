# 視覺來源與製作紀錄

本網站依使用者提供的「載耶主視覺.jpg」、IMG_2020.jpg 與 IMG_2019.jpg 延伸。原始主視覺保留在 design/original-poster.jpg；網頁用 poster.webp 是等比例壓縮版本。實體卡背 030 代表 30 級，不當作卡號。

新繪圖與設計參考使用內建 image_gen 工具製作，並非替換使用者原始海報。設計參考為 mobile-home.png、mobile-team.png；透明愛心插畫原檔為 heart-source.png，網頁使用 public/assets/heart.webp。尺寸與 WebP 轉檔只用於網頁效能最佳化。

## 設計分析

- 手繪暖色拼圖與薑餅人為主要視覺，森林綠 #123d32、奶油白 #fff4dc、紅 #bc4a40、暖黃 #eacb80。
- 手機標題兩行，插畫獨立呈現；左右留白 24px，主要按鈕至少 52px 高。
- 襯線標題搭配易讀內文，分組資訊以單張奶油色票券呈現，避免多層容器。
- 日期與集合地點始終可讀，初次動畫可略過，之後感應直接查詢；減少動態效果偏好獲得尊重。
- 桌面改為文字與插畫並排，維持同一配色及材質。

## 最終生成提示

### Mobile homepage reference (ui-mockup)

Create a high-fidelity standalone mobile website design reference, ONE portrait viewport only, 1024x1792 approximately. Use attached poster as brand/style reference, not as copy-paste whole poster. This is a warm cute refined Traditional Chinese university Christmas event NFC pass website. Hand drawn grainy gouache gingerbread figures, interlocking heart puzzle, forest green #123d32, ivory #fff6df, butter yellow #eacb80, faded coral red #c64b44 and dusty pink. Beautiful editorial Christmas storybook mood. Top ivory compact header showing a small hand drawn puzzle icon and 載耶 2026, small menu icon right. Main forest green hero section with suspended warm yellow string lights at upper edge, title What is Love? in large cream friendly elegant serif on TWO lines, tiny line '在相遇裡，拼出愛的模樣。'. Below title a central medium sized heart formed from red cream pink green jigsaw pieces and two tiny smiling gingerbread helpers, no other competing objects. Under art a cream rounded substantial button '打開聖誕邀請' and small '11.21 SAT · 清華大學教育館'. Bottom of viewport begins cream paper area with beautifully typeset event details 15:30 入場 / 16:00–22:00. Generous 28px side gutters at 390 CSS pixel equivalent, legible Chinese text. It must be a clean real buildable mobile website UI, no phone device frame, no multi-screen collage, no neon, no dashboard chips, no floating rectangles. Touch targets generous and hierarchy clear. Main illustration may be separate hand painted artwork within otherwise clean HTML-rebuildable layout. User's branding takes precedence.

### Hero illustration (illustration-story, transparent)

Generate ONE isolated transparent-background illustration asset for the website in reference image 2, matching the gouache paper cut texture and thick irregular hand ink lines of poster reference image1. A large complete heart jigsaw assembled from warm Christmas red, butter yellow, ivory, dusty pink, forest green pieces, with two adorable tiny smiling gingerbread helpers holding one ivory puzzle piece in the center gap. Center composition all visible with ample transparent margin, square aspect. Hand painted warm cute sophisticated illustration, subtle grain inside paint, dark brown outlines. Absolutely NO text, no letters, no numbers, no backdrop, no UI, no frame, no lights/string. Real alpha transparency, ready to use as a floating hero illustration. Preserve visual language of the supplied art.

### Team reveal reference (ui-mockup)

Generate one standalone portrait mobile website screen reference, 1024x1792 approx, for the LIVE TEAM REVEAL screen of the same Christmas NFC pass website as reference. Keep same hand painted warm storybook palette forest green, cream paper, coral red. Do not repeat the whole home page. Clean ivory top navigation with tiny puzzle mark and 載耶 2026, subtle card number #027. Forest green background, warm string lights. Small top text '你的拼圖夥伴，找到了。' Large singular paper ticket in cream with gently scalloped/tear edges, no nested cards. At top of ticket small red hand drawn puzzle piece, expressive serif large '06', then '暖心薑餅組' in readable Chinese. Thin dashed divider, location with small map-pin icon '集合地點' / '教育館・第六組區域'; single short note '帶著你的小卡，和新朋友打聲招呼。'. Bottom button filled forest green '查看活動資訊'. Tiny gingerbread figure peeking at bottom ticket edge. Footer normal text link '再看一次揭曉動畫'. A small bottom navigation with 活動 / 我的小卡. No fake avatar or members list; one screen only no phone mockup no collage. This is an isolated DEMO team, not real production group. Spacing generous, touch targets large, high contrast.

網站依上述構圖實作可選取文字與真正按鈕，沒有把整張設計圖當作網頁。預覽用組名只在 /demo，正式資料不包含示範名單。
