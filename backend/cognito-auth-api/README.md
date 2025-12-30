# cognito-auth-api

一個最小可用的 Cognito 驗證後端（Express）。

## 必要條件
- 已建立 Cognito User Pool
- 已建立 App Client（建議啟用 `USER_PASSWORD_AUTH` 與 `REFRESH_TOKEN_AUTH`）
- 若你啟用 Email 驗證，註冊後需要輸入驗證碼

## 設定
1. 複製環境變數

```bash
cp .env.example .env
```

2. 填入：
- `AWS_REGION`
- `COGNITO_USER_POOL_ID`
- `COGNITO_CLIENT_ID`
- （可選）`COGNITO_CLIENT_SECRET`
- `FRONTEND_ORIGIN`

## 啟動

```bash
npm install
npm run dev
```

預設監聽：`http://localhost:3001`

## API
- `GET /health`
- `POST /auth/signup` `{ email, password }`
- `POST /auth/confirm` `{ email, code }`
- `POST /auth/login` `{ email, password }`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /auth/me`

> Token 以 HttpOnly cookie 儲存（access/id/refresh）。
