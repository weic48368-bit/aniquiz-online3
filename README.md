# AniQuiz Love 3.0｜戀愛動漫猜謎

多人線上戀愛動漫猜謎遊戲，使用 Node.js、Express、Socket.IO。

## 功能
- 建立房間與 5 位房號、加入房間
- 最多 12 位玩家
- 房主開始與重新開始
- 題庫分類：綜合、近期、經典、早期、校園、純愛、戀愛喜劇、奇幻、虐心
- 每題 20 秒、四選一、答對 100 分、排行榜
- 題庫目前內建 91 道題目，後續可在 `questions.js` 持續擴充

## 本機執行
1. 安裝 Node.js 18 或更新版本
2. 在專案資料夾執行 `npm install`
3. 執行 `npm start`
4. 開啟 `http://localhost:3000`

## 部署到 Render
1. 將此資料夾內的所有檔案上傳到 GitHub repository 根目錄。
2. Render 選 New + → Blueprint，連接 GitHub repository。
3. Render 會讀取 `render.yaml` 建立服務。

## 新增題目
在 `questions.js` 的陣列中新增物件，欄位：
- `title`: 作品名稱
- `year`: 首播年份
- `categories`: 分類代碼陣列
- `label`: 題目顯示標籤
- `question`: 題目
- `options`: 四個選項
- `answer`: 正確選項索引（從 0 開始）

分類代碼：`recent`, `classic`, `early`, `school`, `pure`, `comedy`, `fantasy`, `tearjerker`。
