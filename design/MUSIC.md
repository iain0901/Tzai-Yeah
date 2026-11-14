# 載耶聖誕音樂盒

## 網站素材

- 檔案：`public/assets/christmas-music-box.mp3`
- 曲名：We Wish You a Merry Christmas（傳統聖誕旋律）
- 形式：本專案自製的音樂盒器樂編曲與合成錄音，無人聲。
- 長度：40.000 秒，24 小節，3/4 拍，108 BPM。
- 編碼：MP3、128 kbps、44,100 Hz、雙聲道。
- 大小：641,307 bytes，約 626 KiB。

以圓潤的音樂盒主音、輕柔的高八度泛音、三拍分解和弦、低音和細小鈴聲構成。傳統主旋律演奏兩次，第二次增加輕微高音；接著是八小節原創器樂回應，最後回到下一輪主旋律。

## 來源與製作

傳統單旋律音高參照 John Chambers ABC collection：
<https://abcnotation.com/tunePage?a=trillian.mit.edu%2F~jc%2Fmusic%2Fabc%2Fdemo%2FTunes%2FWeWishYouAMerryChristmas%2F0000>

該條目標示作曲為 Traditional。此處只使用傳統單旋律，不沿用任何現代錄音或現成伴奏。和聲配置、演奏力度、器樂回應、合成音色、聲像與殘響由本專案自行製作。沒有下載演唱者或商業音樂版本，也沒有使用第三方音色取樣。

## 重建

環境需要 Node.js 與 PATH 中的 FFmpeg：

```sh
node scripts/generate-christmas-music.mjs
```

腳本會產生正式 MP3，以及忽略追蹤的 `outputs/christmas-music-box.wav` 和 `outputs/christmas-music-box-report.json`。使用固定噪音種子與固定樂譜，輸出可重現。

## 循環方式與驗證

合成時，音符尾音及六組短殘響依 40 秒長度折回緩衝區開頭，讓最後的小節自然銜接首拍，沒有整首淡出至無聲的間隔。MP3 寫入 Xing/LAME 時間資訊；網站播放器仍須使用循環播放設定。建議背景播放音量約 0.25–0.35，觀看預告時暫停背景音樂。

2026-11-14 客觀檢查：

- FFprobe：40.000000 秒、雙聲道、44,100 Hz、641,307 bytes。
- FFmpeg 完整解碼：3,528,000 個聲道樣本，等同 40 秒雙聲道音訊。
- 解碼後最高音量：−2.6 dBFS；平均音量：−16.2 dBFS。無削波。
- 合成 PCM 最高音量：−2.047 dBFS；RMS：−15.756 dBFS。
- PCM 首尾相鄰樣本差值：左聲道 0.001408、右聲道 −0.000100，低於正常音波相鄰樣本變化。

已檢查檔案、解碼與音量數據；未將這些客觀檢查描述為真人試聽。最終仍以網站實際播放器的載入、播放／暫停與循環驗證為準。
