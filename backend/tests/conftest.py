# SPDX-License-Identifier: Apache-2.0
import os
import sys

# The handlers read these at import time. No AWS call is made while importing,
# and the tests replace every AWS client with a fake.
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ.setdefault("DYNAMODB_TABLE", "test-table")
os.environ.setdefault("TOKEN_PARAMETER", "/test/token")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
