# KiraPay Top Up Demo

這個專案是一個 React + Vite 前端，搭配 Express 後端的 KiraPay Top Up 示範。

功能包含：

- 三個 Top Up 方案卡片
- 輸入 Twitter ID 後，由後端建立 KiraPay payment link
- 使用 Base 鏈 USDC 建立單次付款連結
- 顯示 QRCode、Checkout URL 與 redirect URL
- 付款完成後導回首頁並顯示付款成功 / 付款失敗結果
- 由 KiraPay webhook 自動更新付款狀態
- KIRAPAY_API_KEY 僅放在後端使用

## 環境需求

- Node.js 20+
- npm 10+

## 環境變數

請在專案根目錄建立 `.env`：

```env
KIRAPAY_API_KEY=你的_kirapay_api_key
KIRAPAY_WEBHOOK_SECRET=自訂_webhook_secret
APP_BASE_URL=http://localhost:5173
KIRAPAY_TOKEN_OUT_CHAIN_ID=8453
KIRAPAY_TOKEN_OUT_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
KIRAPAY_RECEIVER_ADDRESS=0x8356D265646a397b2Dacf0e05A4973E7676597f4
KIRAPAY_FIAT_CURRENCY=USD
PORT=8787
```

`APP_BASE_URL` 是 KiraPay 完成付款後要導回的前端頁面。
`KIRAPAY_TOKEN_OUT_CHAIN_ID=8453` 代表 Base 鏈。
`KIRAPAY_TOKEN_OUT_ADDRESS` 預設為 Base USDC 合約地址。
`KIRAPAY_RECEIVER_ADDRESS` 是你要收款的地址。
`KIRAPAY_FIAT_CURRENCY=USD` 會讓 `originalPrice` 依各方案金額建立對應的 USDC 價格。
`KIRAPAY_WEBHOOK_SECRET` 可以不填；如果有設定，後端會驗證 webhook header 或 Bearer Token。

## 安裝

```bash
npm install
```

## 開發模式

```bash
npm run dev
```

啟動後：

- 前端：http://localhost:5173
- 後端：http://localhost:8787

`npm run dev` 會同時啟動：

- Vite 前端開發伺服器
- `server/` 內的 Express 後端

## 可用指令

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
```

## 專案結構

```text
.
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── server/
│   └── index.ts
├── .env
└── package.json
```

## 付款流程

1. 前端載入方案列表
2. 使用者輸入 Twitter ID
3. 使用者點擊 Top Up 按鈕
4. 前端呼叫後端建立付款 session
5. 後端讀取 `.env` 內的 `KIRAPAY_API_KEY`，呼叫 `POST https://api.kira-pay.com/api/link/generate`
6. 後端送出 Base 鏈 USDC payment link 參數：

```json
{
  "tokenOut": {
    "chainId": "8453",
    "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  },
  "receiver": "你的收款地址",
  "originalPrice": 10,
  "fiatCurrency": "USD",
  "name": "@twitter_id",
  "customOrderId": "builder-<sessionId>",
  "redirectUrl": "http://localhost:5173/?sessionId=<sessionId>&source=kirapay",
  "type": "single_use",
  "isViewAsCrypto": false
}
```

7. 前端顯示 KiraPay QRCode 與 Checkout 彈窗
8. 使用者完成付款後，KiraPay 導回前端頁面
9. KiraPay 呼叫後端 webhook
10. 後端更新 session 狀態
11. 前端輪詢 session 狀態並自動顯示成功 / 失敗結果

`name` 會使用使用者輸入的 Twitter ID。
`customOrderId` 會帶入方案代碼與 sessionId，方便對應訂單與 webhook。

## Webhook 設定

本地 webhook endpoint：

```text
http://localhost:8787/api/webhooks/kirapay
```

如果要讓 KiraPay 從外部打到本機，需要先把本機後端透過 tunnel 暴露成公開網址，例如：

```bash
cloudflared tunnel --url http://localhost:8787
```

或：

```bash
ngrok http 8787
```

然後把公開網址後面的 webhook 路徑填到 KiraPay dashboard：

```text
https://你的公開網址/api/webhooks/kirapay
```

如果 KiraPay dashboard 支援自訂 header 或 Bearer Token，建議同步設定 `KIRAPAY_WEBHOOK_SECRET`。

## 本地模擬 webhook

可以用下面的方式模擬付款成功 webhook：

```bash
curl -X POST http://localhost:8787/api/webhooks/kirapay \
  -H 'Content-Type: application/json' \
  -H 'x-kirapay-webhook-secret: 自訂_webhook_secret' \
  -d '{
    "event": "payment.completed",
    "status": "success",
    "metadata": {
      "customOrderId": "builder-請替換成實際sessionId"
    }
  }'
```

如果沒有 secret，可以拿掉 `x-kirapay-webhook-secret` header。

## 建置

```bash
npm run build
```

建置完成後，靜態前端檔案會輸出到 `dist/`。
