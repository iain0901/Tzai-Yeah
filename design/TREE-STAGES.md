# 耶誕樹六階段素材

2026-11-14 使用內建 `image_gen` 分別生成六張獨立圖片，每次呼叫都設定 `transparent_background: true`。六張都是單棵完整樹木的透明 PNG，沒有使用 sprite sheet，也沒有從合圖裁切各階段。

透明 PNG 原稿保留於工作區交付資料夾 `outputs/耶誕樹成長素材`。網站使用 `sharp` 縮放、壓縮後的 WebP，尺寸統一為 **512 × 768**，保留 Alpha 透明通道。網站素材路徑為 `public/assets/tree-stages/tree-stage-N.webp`，其中 `N` 為 1 至 6；瀏覽器網址為 `/assets/tree-stages/tree-stage-N.webp`。

## 風格與構圖

暖心、細緻的水粉與色鉛筆故事書風格，保留柔和紙感與霧面筆觸。以鼠尾草綠、森林綠為主，搭配暖赭色陶盆及單道奶油色盆緣，樹與盆器帶有溫柔的琥珀色亮部。圖片不含文字、標籤、介面、描邊、場景背景或地面。

六張皆採直式 2:3、單棵樹正面置中。樹與盆器約占畫布高度 75–80%，盆底約在畫布高度 90%，四周保留至少 8% 透明空間。各階段在同樣畫布裡完整繪製，遊戲再依成長量調整顯示大小；素材本身不以裁切或重複同一張圖冒充新階段。

## 階段與使用方式

累積星光門檻為 `[0, 10, 30, 75, 150, 300]`，對應 `lib/tree-contracts.ts` 的六個階段名稱。達到下一門檻時切換對應圖片；第六階段後高度數字仍可增加。

| 階段 | 名稱 | 累積星光 | 圖片內容 | 網站檔案 |
| --- | --- | --- | --- | --- |
| 1 | 小小樹苗 | 0–9 | 細小棕色樹幹、兩層稀疏短針葉，尚無裝飾或星星 | `tree-stage-1.webp` |
| 2 | 冒出新芽 | 10–29 | 較高的幼苗、三層疏朗枝葉與淡綠新芽，尚無裝飾或星星 | `tree-stage-2.webp` |
| 3 | 枝葉初長 | 30–74 | 四層逐漸茂密的枝葉，形成小耶誕樹輪廓，尚無裝飾 | `tree-stage-3.webp` |
| 4 | 綠意成蔭 | 75–149 | 五層豐滿枝葉與細緻暖色燈串，尚無頂端星星或大型吊飾 | `tree-stage-4.webp` |
| 5 | 耶誕大樹 | 150–299 | 六層成熟樹冠、金色燈串、紅與奶油色圓球、緞帶與頂端金星 | `tree-stage-5.webp` |
| 6 | 星光巨樹 | 300 以上 | 七層茂盛樹冠、明亮金星與金色裝飾，加入薑餅人吊飾及盆邊小禮物 | `tree-stage-6.webp` |

遊戲場景與排行榜使用相同階段圖片。成長放大與換階動畫由前端控制；圖片、粒子與光效都限制在遊戲自己的裁切場景內，不能蓋住統計、搖動按鈕或底部導覽。系統「減少動態效果」與頁面暫停動態設定仍有效。

## 生成紀錄

以下逐字保留各次內建工具的實際 prompt。階段 1、2 來自本次生成紀錄；階段 3、4 由負責生成的代理提供原文；階段 5、6 來自工作區 `work/tree-stage-5-6-prompts.txt`。六次皆使用 `transparent_background: true`，未使用 CLI 或 API 替代流程。

### Stage 1

```text
Use case: illustration-story.
Asset type: a single standalone transparent PNG game sprite, tree growth stage 1 of a coherent Christmas tree growth series. This must be exactly ONE tree image, not a sprite sheet or multi-panel image.
Primary subject: a very young miniature spruce seedling, a slender brown stem with just TWO sparse, slightly uneven whorls of short needle branches. It clearly reads as a tiny early seedling with lots of airy space between its few branches, not a full mature conical Christmas tree. No decorations and no star.
Style/medium: warmhearted refined hand-painted gouache and colored-pencil storybook illustration, soft subtle paper grain inside the painted subject, matte painted texture, sage and forest greens, gentle amber highlights. No drawn outlines.
Pot: one simple small warm ochre terracotta pot with a single cream rim. Front-facing, same quiet minimal pot design throughout the series.
Composition: portrait 2:3 composition, a single centered front-facing full tree and pot. Total subject height about 75–80% of canvas, top around 12%, bottom of pot baseline around 90% canvas height, generous transparent margins of at least 8%, with all branches and pot fully visible. Scale will be handled by game code.
Background: actual fully transparent alpha around the subject, including between branches. No paper rectangle, no painted background, no checkerboard artwork, no opaque backdrop.
Avoid: text, labels, numerals, UI, border, watermark, extra objects, ornaments, star, ground plane, floor, ground shadow, multiple trees. Only the isolated seedling and its pot.
```

### Stage 2

```text
Use case: illustration-story.
Asset type: a single standalone transparent PNG game sprite, tree growth stage 2 of a coherent Christmas tree growth series. This must be exactly ONE tree image, not a sprite sheet or multi-panel image.
Primary subject: a young upright spruce sapling with THREE distinct sparse, slightly uneven branching tiers of short needle branches and visible brown stem between them, fresh pale green tips, a taller slender trunk. It is beginning to fill out but is still clearly a young airy sapling, not a full mature Christmas tree. No ornaments and no star.
Style/medium: warmhearted refined hand-painted gouache and colored-pencil storybook illustration, soft subtle paper grain inside the painted subject, matte painted texture, sage and forest greens, gentle amber highlights painted on the tree and pot only. No drawn outlines.
Pot: one simple small warm ochre terracotta pot with a single cream rim, front-facing, gently tapered sides and round open top with dark soil. The quiet minimal pot should occupy roughly the bottom quarter of the total subject height.
Composition: portrait 2:3 composition, a single centered front-facing full tree and pot. Total subject height about 75–80% of canvas, top around 12%, bottom of pot baseline around 90% canvas height, generous transparent margins of at least 8%, with all branches and pot fully visible. Scale will be handled by game code.
Background: actual fully transparent alpha around the subject, including between branches. No paper rectangle, no painted background, no checkerboard artwork, no opaque backdrop, no ambient glow or colored halo.
Avoid: text, labels, numerals, UI, border, watermark, extra objects, ornaments, star, ground plane, floor, ground shadow, multiple trees. Only the isolated young sapling and its pot.
```

### Stage 3

```text
Use case: illustration-story
Asset type: independent transparent PNG sprite for stage 3 of a mobile Christmas-tree growing game, not a sprite sheet.
Primary request: One bushy small juvenile fir tree, with four gently irregular layered branches and sage new growth. Dense enough to create a recognizable Christmas-tree silhouette. Completely undecorated: no lights, ornaments, or star.
Style/medium: Warm, refined hand-painted gouache and colored-pencil storybook illustration, soft subtle paper grain within the painted subject, matte painted texture, no outlines.
Color palette: Sage and forest greens, warm ochre terracotta pot with one single cream rim. Gentle amber highlight.
Composition/framing: Portrait 2:3 composition. Single centered front-facing full tree in a small ochre pot. Tree and pot together fill about 75–80% of the canvas height. Pot bottom baseline at approximately 90% of canvas height. At least 8% generous transparent margins. Keep complete foliage, trunk, pot, and rim visible with nothing cropped.
Scene/backdrop: Truly transparent alpha background, clean isolated cutout, preserving soft natural painted edges.
Constraints: Exactly one tree in one pot. No background, ground plane, floor shadow, surrounding objects, outlines, text, labels, numbers, logo, UI, or border. Do not draw a checkerboard. No decorations and no star.
```

### Stage 4

```text
Use case: illustration-story
Asset type: independent transparent PNG sprite for stage 4 of a mobile Christmas-tree growing game, not a sprite sheet.
Primary request: One fuller mature fir tree with five gently irregular foliage tiers, rich sage and forest-green branches, and one fine delicate string of tiny warm fairy lights spiraling around the branches. No large ornaments and no star.
Style/medium: Warm, refined hand-painted gouache and colored-pencil storybook illustration, soft subtle paper grain within the painted subject, matte painted texture, no outlines.
Color palette: Sage and forest greens, warm ochre terracotta pot with one single cream rim. Gentle amber highlight painted only onto the tree and pot themselves.
Composition/framing: Portrait 2:3 composition. Single centered front-facing full tree in a small ochre pot. Tree and pot together fill about 75–80% of the canvas height. Pot bottom baseline at approximately 90% of canvas height. At least 8% generous transparent margins. Keep complete foliage, trunk, pot, and rim visible with nothing cropped.
Scene/backdrop: Truly transparent alpha background, clean isolated cutout, preserving soft natural painted edges. Everything outside the tree and pot must be entirely transparent. No atmospheric glow behind or around the silhouette. Fairy lights may softly illuminate immediately adjacent painted needles but must not create an outer aura.
Constraints: Exactly one tree in one pot. No background color, ground plane, floor shadow, surrounding objects, outlines, text, labels, numbers, logo, UI, or border. Do not draw a checkerboard. No large ornaments, star, halo, or backdrop.
```

### Stage 5

```text
Use case: illustration-story
Asset type: A single transparent game sprite for a refined, warm mobile Christmas tree-growing game. Level 5: mature Christmas fir.
Scene/backdrop: genuinely transparent alpha background. No scenery or ground plane.
Subject: one beautiful mature six-tier Christmas fir, front-facing, single centered full tree. Sage and forest-green foliage, six distinct soft layered branch skirts. A small warm ochre terracotta flowerpot with one simple cream rim. Decorate with restrained tiny warm-gold fairy lights, a few cranberry-red and cream spherical baubles, thin red ribbon bows, and one modest five-point golden star at the very top. Festive but leave plenty of green visible.
Style/medium: warm-hearted exquisite hand-painted gouache and colored-pencil children's storybook illustration, matte painted texture, soft subtle paper grain inside the artwork only, gentle amber highlights, softly dimensional painted foliage. Clean readable silhouette at small mobile sizes.
Composition/framing: portrait 2:3 canvas. Centered and symmetrical overall with natural hand-painted detail. Entire tree including top star and pot fully visible and uncropped. Tree and pot together occupy 75–80% of image height; bottom of pot at approximately 90% of canvas height. Generous transparent margins of at least 8% on every edge. The pot is small compared with the mature tree, centered.
Constraints: Exactly one tree sprite. Genuine clean alpha all around the artwork. No text, labels, numbers, UI, border, outline, watermark, backdrop, floor, ground plane, scenery, people, extra props or gifts. No photorealism, 3D plastic, vector-flat graphics or checkerboard painted into image. Maintain elegant restrained festive detail.
```

### Stage 6

```text
Use case: illustration-story
Asset type: A single transparent game sprite for a refined warm mobile Christmas tree-growing game. Level 6: magnificent starlight giant tree, the joyful final growth stage.
Scene/backdrop: genuinely transparent alpha background. No scenery, no background-color wash, no ground plane, no cast shadow.
Subject: one magnificent full seven-tier towering Christmas fir, front-facing, single centered full tree. Sage and forest-green foliage, seven distinct luxuriant softly layered branch skirts, wider and fuller at the base. A small warm ochre terracotta flowerpot with one simple cream rim. A luminous large five-point golden star crowns the tree. Fine elegant gold garlands and tiny warm fairy lights weave through the green. Tasteful cranberry-red, cream and gold round baubles, exactly three little recognizable gingerbread cookie ornaments, and exactly three tiny wrapped red/cream gifts nestled beside the ochre pot. Grand warm magical climax, with plenty of green foliage visible and simple clear silhouette.
Style/medium: warm-hearted exquisite hand-painted gouache and colored-pencil children's storybook illustration, matte painted texture, soft subtle paper grain inside the artwork only, gentle amber highlights, softly dimensional painted foliage. Elegant, warm, enchanting. Clean readable at small mobile sizes. Not photorealistic or 3D.
Composition/framing: portrait 2:3 canvas. Centered front-facing full tree, whole star and pot and all three tiny gifts visible with no cropping. Tree, star and pot together occupy 75–80% of image height. The baseline of the centered pot and gifts is at 90% of canvas height. At least 8% clean transparent margin around every edge. The pot remains small compared with the grand tree.
Constraints: Exactly one tree sprite. Genuine clean alpha around the artwork, including gaps between branches. Keep any warm radiance very close to the star and bulbs; no broad halo or painted surrounding haze. No text, labels, numbers, UI, border, outlines, watermark, backdrop, floor, ground plane, scenery or people. No plastic 3D shading, vector-flat graphics or checkerboard painted into image. Do not add extra objects besides the three tiny gifts.
```
