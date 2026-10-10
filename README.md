# 小鎮物語 Tiny Town

Three.js 城市建造模擬遊戲，使用 `sketchfab-ultimate16-materials-new.blend` 中的 low-poly 物件（匯出為 `models/town.glb`）。

## 本機執行
```
npx serve .        # 或 python3 -m http.server
```
開啟 http://localhost:3000

## 部署到 Vercel
純靜態網站，不需要 build：
- `npx vercel --prod`（在此資料夾執行），或
- 推到 GitHub 後在 Vercel 匯入專案，Framework Preset 選 **Other**，Build Command 留空，Output Directory 為 `.`

## 玩法
- 道路連接住宅／商業／工業區，蓋風車供電
- 滿意度＋需求足夠時建築自動升級（住宅5級、商業6級、工業3級）
- 公園、警察、消防、學校、醫院提升周邊滿意度；工業造成污染
- 人口里程碑會解鎖新建築並發放獎勵；每 30 天自動存檔（localStorage）
- 快捷鍵：1–0 切換工具、空白鍵暫停、Esc 回到選取
