# AWS CDK Deployment Requirements

**Added:** 2026-10-08  
**Scope:** Deployment target for the Budget Forecasting Analyst application.

---

## Decision

The application will be deployed to AWS using the AWS CDK (Python, `aws-cdk-lib`).
Docker-compose remains valid for **local development only**.
The CDK stack is the production and demo deployment path.

AWS credentials will be supplied by the user at deploy time via environment variables
(`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` if required).
**Credentials must never be stored in the repository, committed to git, or embedded in
any configuration file checked into source control.**

---

## Architecture Mapping to AWS Services

| Component | Local (docker-compose) | AWS (CDK) |
|---|---|---|
| FastAPI backend | Docker container | AWS Fargate (ECS) task — single container, `fastapi-backend` image |
| React frontend | Vite dev server / nginx | S3 static website + CloudFront distribution |
| DuckDB | Local file in container volume | EFS volume mounted to Fargate task (persistent across task restarts) |
| Bedrock LLM | boto3 → Bedrock API (same region) | boto3 → Bedrock API (same region) — no change |
| SSE streaming | FastAPI StreamingResponse | Same — Fargate + ALB with response buffering disabled (`idle_timeout` ≥ 300s) |
| Secrets / env vars | `.env` file | AWS Systems Manager Parameter Store (SecureString for secrets) or Secrets Manager; injected as Fargate task env vars via CDK |
| Dataset file | Local bind mount | S3 bucket (`budget-forecasting-data` bucket); Fargate task has IAM role to read/write |

---

## CDK Stack Design

### Stack: `BudgetForecastingStack`

Located at `infra/app.py` and `infra/stacks/budget_forecasting_stack.py`.

#### Resources to provision:

1. **VPC** — Default VPC or new VPC with public/private subnets (2 AZs minimum).

2. **ECR Repository** — `budget-forecasting-backend` — stores the FastAPI Docker image.
   CDK asset deployment builds and pushes the image automatically.

3. **ECS Cluster** — `budget-forecasting-cluster` — Fargate launch type.

4. **EFS FileSystem** — `budget-forecasting-duckdb-efs` — for DuckDB persistence.
   Mounted at `/data/duckdb` in the Fargate task. Access point scoped to `/duckdb`.

5. **Fargate Task Definition** — 1 vCPU, 2 GB RAM (adjustable via CDK context).
   - Container: FastAPI backend image from ECR.
   - EFS volume mount: `/data/duckdb`.
   - S3 dataset bucket name injected as `S3_DATASET_BUCKET` env var.
   - Bedrock model ID injected from SSM Parameter Store.
   - `REPLAY_ACTIVE` env var injected (default `false`).
   - Port: 8000.

6. **ECS Service** — Fargate service running the task.
   - Desired count: 1 (demo; auto-scaling optional stretch goal).
   - ALB target group attached; health check on `GET /health`.

7. **Application Load Balancer** — HTTPS listener (ACM cert optional; HTTP for demo OK).
   - `idle_timeout`: 310 seconds (> max Bedrock response time).
   - Sticky sessions NOT required (single task).

8. **S3 Bucket** — `budget-forecasting-frontend` — static website bucket (or CloudFront origin).
   - CDK `aws_s3_deployment.BucketDeployment` uploads the Vite build output.
   - Public read via bucket policy OR CloudFront OAI.

9. **CloudFront Distribution** (optional but recommended for demo) —
   - Origin 1: S3 bucket (frontend).
   - Origin 2: ALB (backend API) — path pattern `/api/*` and `/sse/*`.
   - Allows a single domain for the demo.

10. **IAM Roles** —
    - Fargate task execution role: ECR pull, EFS mount, SSM GetParameter, CloudWatch Logs.
    - Fargate task role: `bedrock:InvokeModelWithResponseStream`, S3 GetObject/PutObject on dataset bucket, SSM GetParameter.
    - **No credentials stored in the repo; all permissions via IAM roles.**

11. **SSM Parameters** (created by CDK, values set manually post-deploy or via `cdk deploy --context`):
    - `/budget-forecasting/bedrock-model-id` — SecureString.
    - `/budget-forecasting/replay-active` — String ("true"/"false").

12. **CloudWatch Log Group** — `/ecs/budget-forecasting-backend` — 7-day retention.

---

## CDK Directory Structure

```
infra/
  app.py                          # CDK app entry point
  requirements.txt                # aws-cdk-lib, constructs
  stacks/
    budget_forecasting_stack.py   # Main stack (all resources above)
  README.md                       # Deploy instructions
```

---

## Deployment Instructions (for design document)

```bash
# 1. Install CDK dependencies
cd infra && pip install -r requirements.txt

# 2. Bootstrap CDK (once per account/region)
cdk bootstrap aws://<ACCOUNT_ID>/<REGION>

# 3. Build frontend
cd frontend && npm run build

# 4. Build and deploy (credentials supplied at runtime via env vars)
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... cdk deploy --all

# 5. Set SSM parameters (post-deploy)
aws ssm put-parameter --name /budget-forecasting/bedrock-model-id \
  --value "anthropic.claude-3-5-sonnet-20241022-v2:0" --type SecureString

# 6. Upload sample dataset to S3
aws s3 cp data/Team6Dataset_Enhanced\ 1.xlsx \
  s3://<DATA_BUCKET>/Team6Dataset_Enhanced_1.xlsx
```

---

## Security Notes

- **No credentials in source code or config files.** The CDK stack uses IAM roles exclusively.
- The Fargate task uses a task role with least-privilege permissions scoped to specific resources.
- SSM SecureString parameters are KMS-encrypted at rest.
- The dataset S3 bucket has public access blocked; only the Fargate task role can read it.
- The `.env` file (local dev only) is in `.gitignore`.
- The `.env.example` documents all required variables without values.
- When the user supplies AWS credentials for deployment, they should be used only in the
  terminal session and never written to any file in the project directory.

---

## NFR Impact

- **NFR-01 (docker-compose):** Retained for local development. `docker-compose up` still works.
- **NFR-02 (README):** Add a "Deploying to AWS" section covering CDK commands.
- A new CDK README at `infra/README.md` covers bootstrapping, deployment, and teardown.
- The CDK stack outputs the ALB DNS name and CloudFront URL after deploy.
