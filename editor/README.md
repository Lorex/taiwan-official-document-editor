# 公文 Editor（Web 版）

瀏覽器版公文編輯器：左側編輯表單、右側依公文格式即時預覽。後端 Express +
SQLite，前端原生 HTML/JS + Tailwind CSS。

## 執行

```bash
cd editor
npm install
npm start          # 會先建置 Tailwind CSS，再啟動伺服器
```

開啟 http://localhost:3000 （可用 `PORT` 環境變數調整）。

開發時可分開跑樣式監看與伺服器：

```bash
npm run watch:css   # 監看並重建 frontend/public/app.css
npm run dev         # 啟動伺服器（不重建 CSS）
```

## 專案結構

```
editor/
├── backend/                Express + SQLite（後端）
│   ├── server.js           伺服器：靜態檔、REST API、統編查詢、字型/範本
│   ├── db.js               SQLite 資料層：公文/發文字號 CRUD、取號
│   └── data/letters.db     SQLite 資料庫（git 忽略，自動建立）
├── frontend/               瀏覽器前端
│   ├── public/             靜態資產（由後端伺服）
│   │   ├── index.html
│   │   ├── app.css         Tailwind 建置輸出（git 忽略）
│   │   ├── config.js       發文公司/速別設定
│   │   ├── api.js          REST 客戶端（window.editorAPI）
│   │   ├── editor.js       左側表單、取號、統編查詢、自動儲存、觸發預覽
│   │   └── preview.js      右側即時公文預覽 + 範本 docx
│   ├── src/input.css       Tailwind 原始碼（@apply 元件 + 公文預覽樣式）
│   ├── tailwind.config.js
│   └── assets/kaiu.ttf     標楷體字型（git 忽略，自動複製）
├── package.json
└── README.md
```

前端透過 `fetch` 呼叫後端 REST API；`api.js` 封裝成與舊版相同的 `window.editorAPI`
介面，因此 `editor.js` / `preview.js` 不需更動。

## REST API

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/letters` | 公文清單 |
| GET | `/api/letters/:id` | 取得公文 |
| POST | `/api/letters` | 新增公文 |
| PUT | `/api/letters/:id` | 更新公文 |
| DELETE | `/api/letters/:id` | 刪除公文 |
| GET | `/api/docnumbers` | 發文字號清單 |
| POST/PUT/DELETE | `/api/docnumbers[/:id]` | 字號 CRUD |
| POST | `/api/docnumbers/:code/issue` | 取號（回傳流水號） |
| GET | `/api/company/lookup?taxId=` | 受文者統編查詢（GCIS 開放資料） |
| GET | `/api/preview-docx` | 範本公文 docx |

## 資料庫

**`doc_numbers`（發文字號）**：`id`、`code`(字號)、`current_serial`(目前取號號碼，
存最後發出的完整流水號供每日歸零)、`description`。首次啟動種子化「矽商」「矽公」。

**`letters`（公文）**：`id`、`code`(字號)、`serial`(流水號)、`data`(JSON：受文者／
發文公司／日期／速別／附件／主旨／說明／正本／副本)、`created_at`、`updated_at`。

## 公文格式

右側即時預覽依《文書處理手冊》「函」格式：

- 紙張 A4、四周邊界 2.5 公分
- 中文楷書（標楷體）、英文及阿拉伯數字 Times New Roman
- 字級：機關全銜 20pt（置中）、受文者/主旨/說明 16pt、地址/聯絡方式/發文日期/
  發文字號/速別/密等/附件/正本/副本 12pt、檔號/保存年限/頁尾頁碼 10pt
- 行距：20pt→36pt、16pt→28pt、12pt→15pt、10pt→10pt
- 檔號、保存年限置於首頁右上方
- 發文日期自動轉民國，發文字號由字號＋流水號組成

預覽會自動縮放以符合預覽區寬度。未開啟公文時顯示範本 `請款公文.docx`。

## 字型

標楷體（`kaiu.ttf` / DFKai-SB）為 Windows 專有字型，已列入 `.gitignore`。後端啟動
時若 `frontend/assets/kaiu.ttf` 不存在，會自動從 Windows 字型夾複製；缺檔時前端
退回系統的 Kai／serif CJK 字型。

## 相依

後端：`express`、`better-sqlite3`。前端（由後端以 `/vendor` 伺服）：`quill`(富文本)、
`docx-preview` + `jszip`(範本渲染)。建置：`tailwindcss`。
