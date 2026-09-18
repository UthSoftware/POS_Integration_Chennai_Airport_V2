# new1vendor - eShopaid SOAP to Vidveda Cloud Integration

This Node.js service fetches sales transactions, line items, and payment records from the **eShopaid ASMX SOAP Service** (tested in `vendorside`), formats and groups the records by `RECEIPT_NO`, and securely posts them to the **Vidveda POS Cloud Ingest API** (from `VendorSide_2`).

---

## Features

- **Multi-Segment Fetching**: Concurrently queries `TransactionSegment`, `ItemSegment`, and `PaymentSegment`.
- **Receipt Grouping & Normalization**: Combines records by `RECEIPT_NO`, strips XML diffgram metadata, and outputs standardized `G100`, `G111`, and `G115` records.
- **Vidveda Cloud Poster**: Transmits data to `CLOUD_API_URL` with bearer authorization, unique request IDs, and exponential backoff retry.
- **Dual Mode (Mock / Live / Auto)**:
  - `mock`: Uses pre-loaded sanitized sample data from `data/sample_soap_response.json` (great for offline testing without access to the local store network).
  - `live`: Direct connection to the real store eShopaid SOAP endpoint.
  - `auto`: Tries live SOAP first; if the local server is unreachable, automatically falls back to mock data.
- **Execution Flexibility**:
  - One-time test execution (`node index.js --once --mock`)
  - Continuous cron scheduler (`ENABLE_SCHEDULER=true`)
  - REST API server (`server.js`) with endpoints for health, sample inspection, and remote trigger.

---

## Quick Start

### 1. Install Dependencies
```bash
cd new1vendor
npm install
```

### 2. Configure Environment (`.env`)
```ini
# Cloud API URL & Key
CLOUD_API_URL=https://pos-integration-chennai-airport-v2.uthsoftware.com/api/vendor-data/ingest
CLOUD_API_KEY=your_api_key_here

# Vendor Information
VENDOR_ID=VVC00047
VENDOR_NAME=eShopaidStore

# Source Mode: mock, live, auto
DATA_SOURCE_MODE=mock

# Local SOAP API
SOAP_URL=https://bagzone.eshopaid.com/BagzoneMallInt/eShopaidServices.asmx
SOAP_ACTION=http://eshopaid.in/GetResponseAsDataSet
SOAP_USERNAME=ATDCA
SOAP_PASSWORD=Wonder#123

# Scheduler
ENABLE_SCHEDULER=false
FETCH_INTERVAL_MINUTES=15
```

---

## Running the Application

### Option A: One-Time Test Run (Mock Data)
```bash
npm run once:mock
# or
node index.js --once --mock
```

### Option B: One-Time Test Run (Live SOAP)
```bash
npm run once:live
# or
node index.js --once --live
```

### Option C: Start REST API Server
```bash
npm run server
# or
node server.js
```
Available HTTP endpoints:
- `GET http://localhost:4000/health`: Health check & active mode.
- `GET http://localhost:4000/sample`: Inspect loaded sample receipts.
- `GET http://localhost:4000/fetch?mode=mock`: Manually trigger fetch and post.

### Option D: Run in Background with PM2
```bash
pm2 start ecosystem.config.js
pm2 status
pm2 logs VidvedaSOAP
```

---

## Log Files
Logs are automatically written to:
- `logs/combined.log`: All system logs with timestamps.
- `logs/error.log`: Error traces and failed retry alerts.
- `logs/soap.log`: Raw XML responses received from SOAP endpoints.
