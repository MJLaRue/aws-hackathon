#!/usr/bin/env python3
"""CDK app entry point. Credentials come from the caller's environment; nothing is stored here."""
import os

import aws_cdk as cdk

from stacks.budget_forecasting_stack import BudgetForecastingStack

app = cdk.App()
BudgetForecastingStack(
    app,
    "BudgetForecastingStack",
    env=cdk.Environment(
        account=os.environ.get("CDK_DEFAULT_ACCOUNT"),
        region=os.environ.get("CDK_DEFAULT_REGION", "us-east-1"),
    ),
)
app.synth()
