"""
lambda_handler.py
=================
AWS Lambda entrypoint.  Uses aws-wsgi to bridge API Gateway proxy events
to the Flask app defined in app.py.

Deploy notes
------------
- Runtime: Python 3.11 (or 3.10)
- Handler: lambda_handler.handler
- Environment variables: DATA_SOURCE=s3, S3_BUCKET=<bucket>, S3_KEY=<key>
- Layer / requirements: see requirements.txt  (bundle with pip install -t)
- Memory: 512 MB recommended (pandas + openpyxl in-memory)
- Timeout: 30 s

The Excel file should be uploaded to S3 once and re-used across invocations
via the module-level DataFrame cache in data_loader.py.
"""

import awsgi
from app import app


def handler(event, context):
    """API Gateway → Flask bridge."""
    return awsgi.response(app, event, context, base64_content_types={"image/png"})
