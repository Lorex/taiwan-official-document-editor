'use strict';

// 前端執行期設定。
// 發文公司資料改由後端資料庫管理（系統管理 → 公司資料維護）；此處的 companies
// 為執行期快取，啟動時由 editor.js 從 /api/companies 載入，供右側預覽查詢信頭。
window.LetterConfig = {
  companies: [],            // runtime cache, filled from the API
  priorities: ['普通件', '速件', '最速件'],  // 速別選項
  // 機關單位分類代碼 → 顯示名稱（與後端 ORG_CATEGORIES 對應）
  orgCategoryLabels: {
    company: '公司團體',
    nonprofit: '非營利團體',
    school: '學校團體',
    government: '政府機關',
  },
};
