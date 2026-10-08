# Budget Forecasting Dashboard — AWS Hackathon

AI-powered budgeting and forecasting application for university financial data.

## Local Development

### Backend (Python / Flask)

```bash
cd backend
pip install -r requirements.txt

# Copy and edit the env file
cp .env.example .env      # DATA_SOURCE=local is the default

python app.py             # starts on http://localhost:8000
```

Test the Phase 1 API:
```bash
curl http://localhost:8000/api/health
curl "http://localhost:8000/api/summary?fiscal_year=FY2026"
curl "http://localhost:8000/api/anomalies?report_status=Draft&limit=10"
curl "http://localhost:8000/api/trends/monthly?fiscal_year=FY2025"
```

### Phase 2 – Forecasting & Scenarios

Train the models and generate Jul-Dec 2026 forecasts (run once, artifacts are cached):
```bash
curl -X POST http://localhost:8000/api/forecast/run
```

Then query forecasts and scenarios:
```bash
# MAE / WAPE comparison
curl http://localhost:8000/api/forecast/metrics

# All 10 series forecasts
curl http://localhost:8000/api/forecast/results

# One series
curl "http://localhost:8000/api/forecast/results?department=College+of+Pharmacy"

# List preset what-if scenarios
curl http://localhost:8000/api/scenarios/presets

# Run a preset
curl http://localhost:8000/api/scenarios/preset/salary_increase_5pct
curl http://localhost:8000/api/scenarios/preset/austerity

# Custom scenario
curl -X POST http://localhost:8000/api/scenarios/run \
  -H "Content-Type: application/json" \
  -d '{"scenario_name":"My Test","adjustments":[{"type":"category","name":"Personnel & Salaries","change_pct":5.0},{"type":"category","name":"Travel & Conferences","change_pct":-10.0}]}'
```

Run Phase 2 validation (no Flask required):
```bash
cd backend
python test_phase2.py
```

### Frontend (React / Vite)

In a separate terminal:
```bash
cd frontend
npm install        # installs React, Vite, and Recharts
npm run dev        # starts on http://localhost:5173
```

Vite proxies `/api/*` to `localhost:8000` automatically.
Open http://localhost:5173 — the dashboard has 4 tabs: Overview, Forecasting, Anomalies, Scenario Planner.

---

## API Endpoints

### Phase 1

| Method | Path                          | Description                          |
|--------|-------------------------------|--------------------------------------|
| GET    | /api/health                   | Liveness + row count                 |
| GET    | /api/filters                  | Dropdown options for all filters     |
| GET    | /api/summary                  | KPI cards (budget, actual, variance) |
| GET    | /api/trends/monthly           | Monthly budget vs actual vs forecast |
| GET    | /api/breakdown/department     | Budget/actual per department         |
| GET    | /api/breakdown/category       | Budget/actual per category           |
| GET    | /api/anomalies                | Anomaly records table                |
| GET    | /api/anomalies/summary        | Anomaly counts by type and status    |
| GET    | /api/series                   | 36-month series for one dept+cat     |

### Phase 2 – Forecasting & Scenarios

| Method | Path                             | Description                                   |
|--------|----------------------------------|-----------------------------------------------|
| POST   | /api/forecast/run                | Train GB model + generate Jul-Dec 2026 forecasts |
| GET    | /api/forecast/results            | All series forecasts (from saved artifact)    |
| GET    | /api/forecast/metrics            | MAE/WAPE comparison (GB vs naive)             |
| GET    | /api/scenarios/presets           | List available preset scenarios               |
| POST   | /api/scenarios/run               | Custom what-if scenario                       |
| GET    | /api/scenarios/preset/\<id\>     | Run a named preset scenario                   |

### Common query parameters (Phase 1 endpoints)
`fiscal_year`, `department`, `category`, `fund_source`, `report_status`,
`month_start` (YYYY-MM), `month_end` (YYYY-MM), `include_synthetic` (true/false)

---

## AWS Deployment (Phase 2)

1. Upload `Team6Dataset_Enhanced.xlsx` to S3:
   ```
   aws s3 cp Team6Dataset_Enhanced.xlsx s3://<bucket>/data/
   ```

2. Set Lambda environment variables:
   ```
   DATA_SOURCE=s3
   S3_BUCKET=<bucket>
   S3_KEY=data/Team6Dataset_Enhanced.xlsx
   ```

3. Package and deploy:
   ```bash
   cd backend
   pip install -r requirements.txt -t package/
   cp *.py package/
   cd package && zip -r ../lambda.zip . && cd ..
   aws lambda update-function-code --function-name budget-api --zip-file fileb://lambda.zip
   ```

4. Deploy frontend to Amplify:
   ```bash
   cd frontend
   npm run build             # outputs to dist/
   # Connect dist/ to Amplify Console or use Amplify CLI
   ```

---

## Project Structure

```
AWS Hackathon/
├── Team6Dataset.xlsx              # Original source (unchanged)
├── Team6Dataset_Enhanced.xlsx     # Enhanced workbook (single data source)
├── enhance_dataset.py             # Dataset generation script
├── README.md
├── artifacts/                     # Generated by Phase 2 (gitignore)
│   ├── forecast_results.json      #   Point forecasts + validation actuals
│   ├── model_metrics.json         #   MAE/WAPE for GB vs naive
│   ├── gb_model.joblib            #   Serialised GradientBoostingRegressor
│   └── label_encoders.joblib      #   Dept/category label encoders
├── backend/
│   ├── app.py                     # Flask API (local + Lambda, Phase 1+2)
│   ├── data_loader.py             # Excel load + S3 + in-process cache
│   ├── analytics.py               # All financial calculations (Phase 1)
│   ├── forecasting.py             # ML forecasting engine (Phase 2)
│   ├── scenarios.py               # What-if scenario engine (Phase 2)
│   ├── test_phase2.py             # Phase 2 validation tests
│   ├── lambda_handler.py          # API Gateway → Flask bridge
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── package.json
    ├── vite.config.js             # Proxy /api → localhost:8000
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx                # Main dashboard layout
        ├── api.js                 # API client (Phase 1 + 2 endpoints)
        └── components/
            ├── KPICards.jsx
            ├── FiltersBar.jsx
            └── AnomalyTable.jsx
```

## Phase Roadmap

| Phase | Status     | Scope                                           |
|-------|------------|-------------------------------------------------|
| 0     | ✅ Done    | Data cleaning & enhancement (enhance_dataset.py)|
| 1     | ✅ Done    | Backend API + React scaffold                    |
| 2     | ✅ Done    | ML forecasting + scenario analysis              |
| 3     | ✅ Done    | Interactive dashboard (Recharts, 4 tabs)        |
| 4     | Planned    | Bedrock chatbot + full AWS deployment           |
