# Deploying to AWS (CDK)

Stack `BudgetForecastingStack`: VPC (2 AZs), EFS for DuckDB, ECS Fargate backend behind an ALB (idle timeout 310 s),
S3 data bucket, S3 frontend bucket, CloudFront (`/` serves the SPA, `/api/*` goes to the ALB with the `/api` prefix
stripped at the edge), SSM parameters and a 7-day CloudWatch log group. Credentials are never stored in the repo:
supply them through your shell environment at deploy time.

## Deploy

```bash
# 1. Dependencies (Python 3.10+ and the CDK CLI: npm i -g aws-cdk)
cd infra && pip install -r requirements.txt

# 2. Bootstrap, once per account/region
cdk bootstrap aws://<ACCOUNT_ID>/<REGION>

# 3. Build the frontend against the CloudFront-relative API path
cd ../frontend && npm ci && VITE_API_BASE_URL=/api npm run build

# 4. Deploy (builds backend/Dockerfile.ecs with the repo root as context, so Docker must be running)
cd ../infra && cdk deploy --all

# 5. Set the model (or pass -c bedrock_model_id=<id> to cdk deploy) and optionally turn on replay mode
aws ssm put-parameter --name /budget-forecasting/bedrock-model-id --value "<MODEL_OR_PROFILE_ID>" --type String --overwrite
aws ssm put-parameter --name /budget-forecasting/replay-active --value true --type String --overwrite
aws ecs update-service --cluster budget-forecasting-cluster --service <SERVICE_NAME> --force-new-deployment

# 6. Optional: park the enhanced sample in the dataset bucket (the image already bundles ./data)
aws s3 cp "data/Team6Dataset_Enhanced 1.xlsx" s3://<DataBucketName>/Team6Dataset_Enhanced_1.xlsx
```

Stack outputs: `CloudFrontUrl`, `AlbDnsName`, `DataBucketName`, `EcrRepositoryUri`.

## Notes

- The model id parameter is a plain `String`. CloudFormation cannot create `SecureString` parameters, and a model id is not a secret. Container secrets read both parameters at task start, so restart the service after changing them.
- The image comes from the CDK asset pipeline. The `budget-forecasting-backend` ECR repository is provisioned for manual pushes but is not what the service pulls from.
- CloudFront's origin read timeout defaults to 60 s. Streaming chat longer than that needs a raised quota, or call the ALB directly.
- The ALB is HTTP only (demo). Add an ACM certificate and an HTTPS listener before real use.
- Bedrock model access must be enabled in the target region for the account.

## Teardown

```bash
cdk destroy --all
```

Buckets, EFS and the log group use `DESTROY` removal policies, so teardown deletes the data.

## Verify without deploying

```bash
cd infra && cdk synth        # or: python app.py
```
