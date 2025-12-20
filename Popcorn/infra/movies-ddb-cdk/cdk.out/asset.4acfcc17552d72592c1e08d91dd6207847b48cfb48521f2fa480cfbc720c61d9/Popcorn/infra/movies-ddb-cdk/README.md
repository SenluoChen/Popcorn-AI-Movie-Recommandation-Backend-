# Popcorn (AWS) — DynamoDB + API + Frontend (CDK)

This CDK app now deploys:
- DynamoDB table for movies
- HTTP API (API Gateway v2) + Lambda `/search` (reads DynamoDB + calls OpenAI for embeddings)
- Static frontend hosting (S3 + CloudFront) for the React build output

## Prereqs
- AWS CLI configured (`aws configure` or SSO)
- Node.js installed

## Install
```bash
cd infra/movies-ddb-cdk
npm install
```

## Deploy
```bash
cd infra/movies-ddb-cdk
npm run deploy
```

### OpenAI API Key（建議用 SSM SecureString）

為了不要把 OpenAI key 塞進 CloudFormation / Lambda env（比較安全），這個專案預設讓 Lambda 在 runtime 從 SSM Parameter Store 讀取：
- Parameter name: `/relivre/openai_api_key`

（相容性提醒）目前 Infra 預設仍使用 `/relivre/openai_api_key` 與 `reLivre-movies` 等既有資源命名，以避免重新建立資源。

建立/更新參數（PowerShell）：
```powershell
powershell -ExecutionPolicy Bypass -File tools/set-openai-ssm-key.ps1 -Name /relivre/openai_api_key -Region eu-west-3
```

補充：
- 不建議用 `aws ssm get-parameter --with-decryption`（會把 secret 直接印出來）
- Lambda 已避免把 OpenAI 的 error body 直接寫進 logs/回傳內容（降低誤洩漏風險）

（快速但不建議的替代方案）也可以在 deploy 時直接用環境變數讓 CDK 把 key 寫進 Lambda env：
```powershell
$env:OPENAI_API_KEY = "<your key>"
```

### Frontend build requirement

CloudFront deploy uploads the React production build from the repo root `build/` directory.
Run this first from the repo root:

```bash
npm install
npm run build
```

After deployment, CDK outputs:
- `MoviesTableName` (DynamoDB table)
- `ApiUrl` (HTTP API base URL; search endpoint is `${ApiUrl}search`)
- `FrontendUrl` (CloudFront URL)

## Notes
- Partition key: `imdbId` (string)
- GSI: `TitleLowerIndex` (pk: `titleLower`, sk: `year`)
- Billing: on-demand (PAY_PER_REQUEST)
- PITR enabled, removal policy RETAIN

### API usage

`POST /search`

Body:
```json
{ "query": "Formula 1 賽車 電影", "topK": 5 }
```
