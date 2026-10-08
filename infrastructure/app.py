#!/usr/bin/env python3
"""
CDK app entry point.
Run from the infrastructure/ directory:
    cdk synth
    cdk deploy
"""

import aws_cdk as cdk
from stacks.budget_stack import BudgetStack

app = cdk.App()

BudgetStack(
    app, "BudgetIntelligenceStack",
    env=cdk.Environment(
        account=app.node.try_get_context("account"),
        region=app.node.try_get_context("region") or "us-east-1",
    ),
    description="Budget Intelligence Dashboard — Lambda + API Gateway + S3 + Amplify",
)

app.synth()
