"""
budget_stack.py
===============
AWS CDK stack for the Budget Intelligence Dashboard.

Resources created
-----------------
  S3 bucket          — stores Team6Dataset_Enhanced.xlsx + forecast artifacts
  Lambda function    — Python 3.11, Flask via awsgi, 512 MB, 30 s timeout
  API Gateway        — REST API with proxy integration, CORS enabled
  Amplify app        — hosts the React frontend from GitHub Dev_HV branch
  IAM role           — Lambda execution role with S3 read + Bedrock invoke

Environment variables injected into Lambda
------------------------------------------
  DATA_SOURCE        = "s3"
  S3_BUCKET          = <bucket name>
  S3_KEY             = "data/Team6Dataset_Enhanced.xlsx"
  BEDROCK_REGION     = stack region
  BEDROCK_MODEL_ID   = from context (default: amazon.titan-text-premier-v1:0)
  CORS_ORIGIN        = Amplify app URL (set after first deploy via console or
                       second cdk deploy after Amplify URL is known)
"""

import os
from aws_cdk import (
    Stack,
    Duration,
    RemovalPolicy,
    CfnOutput,
    aws_s3 as s3,
    aws_s3_deployment as s3deploy,
    aws_lambda as lambda_,
    aws_apigateway as apigw,
    aws_iam as iam,
    aws_amplify_alpha as amplify,
)
from aws_cdk import aws_codebuild as codebuild
from constructs import Construct


class BudgetStack(Stack):

    def __init__(self, scope: Construct, construct_id: str, **kwargs) -> None:
        super().__init__(scope, construct_id, **kwargs)

        # ── Pull context values (set in cdk.json or via --context) ───────────
        bedrock_model_id = self.node.try_get_context("bedrock_model_id") \
            or "amazon.titan-text-premier-v1:0"
        github_owner     = self.node.try_get_context("github_owner") or "MJLaRue"
        github_repo      = self.node.try_get_context("github_repo")  or "aws-hackathon"
        github_branch    = self.node.try_get_context("github_branch") or "Dev_HV"
        github_token_arn = self.node.try_get_context("github_token_arn") or ""

        # ── 1. S3 bucket ──────────────────────────────────────────────────────
        data_bucket = s3.Bucket(
            self, "BudgetDataBucket",
            bucket_name=None,          # let CDK generate a unique name
            versioned=False,
            removal_policy=RemovalPolicy.RETAIN,   # keep data on stack destroy
            block_public_access=s3.BlockPublicAccess.BLOCK_ALL,
            encryption=s3.BucketEncryption.S3_MANAGED,
        )

        # Upload the Excel workbook on every deploy
        # Assumes cdk deploy is run from the infrastructure/ directory;
        # adjust the path if running from the repo root.
        workbook_path = os.path.join(
            os.path.dirname(__file__), "..", "..",
            "Team6Dataset_Enhanced.xlsx"
        )
        if os.path.exists(workbook_path):
            s3deploy.BucketDeployment(
                self, "UploadWorkbook",
                sources=[s3deploy.Source.asset(os.path.dirname(workbook_path),
                    exclude=["*", "!Team6Dataset_Enhanced.xlsx"])],
                destination_bucket=data_bucket,
                destination_key_prefix="data",
            )

        # ── 2. Lambda execution role ──────────────────────────────────────────
        lambda_role = iam.Role(
            self, "LambdaExecutionRole",
            assumed_by=iam.ServicePrincipal("lambda.amazonaws.com"),
            managed_policies=[
                iam.ManagedPolicy.from_aws_managed_policy_name(
                    "service-role/AWSLambdaBasicExecutionRole"
                ),
            ],
        )

        # S3: read only from the data bucket
        data_bucket.grant_read(lambda_role)

        # Bedrock: invoke model
        lambda_role.add_to_policy(
            iam.PolicyStatement(
                actions=["bedrock:InvokeModel"],
                resources=[
                    f"arn:aws:bedrock:{self.region}::foundation-model/*",
                ],
            )
        )

        # ── 3. Lambda function ────────────────────────────────────────────────
        # The Lambda package is built separately (see deploy instructions).
        # We reference the pre-built zip from ../lambda_package/lambda.zip.
        lambda_package_path = os.path.join(
            os.path.dirname(__file__), "..", "lambda_package"
        )

        budget_fn = lambda_.Function(
            self, "BudgetApiFunction",
            runtime=lambda_.Runtime.PYTHON_3_11,
            code=lambda_.Code.from_asset(lambda_package_path),
            handler="lambda_handler.handler",
            role=lambda_role,
            memory_size=512,
            timeout=Duration.seconds(60),
            environment={
                "DATA_SOURCE":      "s3",
                "S3_BUCKET":        data_bucket.bucket_name,
                "S3_KEY":           "data/Team6Dataset_Enhanced.xlsx",
                "BEDROCK_REGION":   self.region,
                "BEDROCK_MODEL_ID": bedrock_model_id,
                "BEDROCK_MAX_TOKENS": "1024",
                "BEDROCK_TEMPERATURE": "0.2",
                "FLASK_DEBUG":      "false",
                # CORS_ORIGIN is set after Amplify URL is known;
                # defaults to * in app.py which is safe for a hackathon demo
            },
        )

        # ── 4. API Gateway ────────────────────────────────────────────────────
        api = apigw.RestApi(
            self, "BudgetApi",
            rest_api_name="budget-intelligence-api",
            description="Budget Intelligence Dashboard API",
            default_cors_preflight_options=apigw.CorsOptions(
                allow_origins=apigw.Cors.ALL_ORIGINS,
                allow_methods=apigw.Cors.ALL_METHODS,
                allow_headers=["Content-Type", "Authorization"],
            ),
            deploy_options=apigw.StageOptions(
                stage_name="prod",
                throttling_rate_limit=100,
                throttling_burst_limit=50,
            ),
        )

        # Proxy ALL /api/* requests to Lambda
        api_resource = api.root.add_resource("api")
        proxy = api_resource.add_proxy(
            default_integration=apigw.LambdaIntegration(
                budget_fn,
                proxy=True,
                timeout=Duration.seconds(29),   # API GW max is 29 s
            ),
            any_method=True,
        )

        # ── 5. Amplify frontend ───────────────────────────────────────────────
        # Amplify needs a GitHub personal access token stored in Secrets Manager.
        # If github_token_arn is provided, use it; otherwise skip Amplify
        # (you can connect manually in the console).
        if github_token_arn:
            github_token = amplify.GitHubSourceCodeProvider(
                owner=github_owner,
                repository=github_repo,
                oauth_token=None,   # will be replaced below
            )

            amplify_app = amplify.App(
                self, "BudgetAmplifyApp",
                app_name="budget-intelligence",
                source_code_provider=amplify.GitHubSourceCodeProvider(
                    owner=github_owner,
                    repository=github_repo,
                    oauth_token=self._get_github_token(github_token_arn),
                ),
                build_spec=codebuild.BuildSpec.from_object({
                    "version": "1.0",
                    "frontend": {
                        "phases": {
                            "preBuild": {
                                "commands": ["cd frontend", "npm install"],
                            },
                            "build": {
                                "commands": [
                                    f"echo VITE_API_BASE_URL={api.url.rstrip('/')} > .env",
                                    "npm run build",
                                ],
                            },
                        },
                        "artifacts": {
                            "baseDirectory": "frontend/dist",
                            "files": ["**/*"],
                        },
                        "cache": {
                            "paths": ["frontend/node_modules/**/*"],
                        },
                    },
                }),
                environment_variables={
                    "VITE_API_BASE_URL": api.url.rstrip("/"),
                },
            )

            main_branch = amplify_app.add_branch(
                "main-branch",
                branch_name=github_branch,
                auto_build=True,
            )

            CfnOutput(self, "AmplifyAppUrl",
                value=f"https://{github_branch}.{amplify_app.default_domain}",
                description="Amplify frontend URL",
            )

        # ── Outputs ───────────────────────────────────────────────────────────
        CfnOutput(self, "ApiGatewayUrl",
            value=api.url,
            description="API Gateway base URL — set as VITE_API_BASE_URL in Amplify",
        )
        CfnOutput(self, "DataBucketName",
            value=data_bucket.bucket_name,
            description="S3 bucket storing the workbook and forecast artifacts",
        )
        CfnOutput(self, "LambdaFunctionName",
            value=budget_fn.function_name,
            description="Lambda function name",
        )

    def _get_github_token(self, secret_arn: str):
        """Retrieve GitHub OAuth token from Secrets Manager ARN."""
        from aws_cdk import SecretValue
        return SecretValue.secrets_manager(secret_arn)
