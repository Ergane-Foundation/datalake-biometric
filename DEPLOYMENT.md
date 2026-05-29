# ðŸš€ Deployment Guide - Datalake Biometric

## Android APK Build & Deployment

### Prerequisites
- Android NDK 23+
- Java JDK 11+
- Gradle 9.3.1+
- React Native CLI

### Build Steps

#### 1. Setup Environment

```bash
# Install all dependencies
yarn install

# Download ML models
python ml_prep/setup_models.py
```

#### 2. Build APK

```bash
# Development debug APK
cd example/android
./gradlew assembleDebug

# Production release APK (requires keystore)
./gradlew assembleRelease \
  -Pandroid.injected.signing.store.file=keystore.jks \
  -Pandroid.injected.signing.store.password=$KEYSTORE_PASSWORD \
  -Pandroid.injected.signing.key.alias=biometric \
  -Pandroid.injected.signing.key.password=$KEY_PASSWORD
```

#### 3. Deploy to Device

```bash
# Install on connected device
adb install app/build/outputs/apk/debug/app-debug.apk

# Launch app
adb shell am start -n com.datalakebiometric.example/.MainActivity

# View logs
adb logcat | grep DatalakeBiometric
```

#### 4. Verify Installation

App should show:
- âœ“ Menu screen with 4 navigation options
- âœ“ "SDK: Initialized âœ“" footer
- All buttons enabled

---

## AWS Backend Deployment

### Lambda Setup

#### 1. Package Python Dependencies

```bash
cd backend
mkdir python-package
pip install -r requirements.txt -t python-package/
cd python-package
zip -r ../lambda.zip .
cd ..
zip lambda.zip lambda_sync_handler.py
```

#### 2. Create Lambda Function

```bash
# Via AWS CLI
aws lambda create-function \
  --function-name biometric-sync-production \
  --runtime python3.11 \
  --role arn:aws:iam::ACCOUNT_ID:role/lambda-execution-role \
  --handler lambda_sync_handler.handler \
  --zip-file fileb://lambda.zip \
  --timeout 30 \
  --memory-size 512 \
  --environment Variables="{
    DYNAMODB_TABLE=biometric-attendance-prod,
    WORKERS_TABLE=biometric-workers,
    ATTENDANCE_SECRET=$(openssl rand -hex 32)
  }"

# Or via AWS Console:
# Lambda > Create Function > Python 3.11
# Upload lambda.zip file
```

#### 3. Configure DynamoDB

```bash
# Create main table
aws dynamodb create-table \
  --table-name biometric-attendance-prod \
  --attribute-definitions AttributeName=record_id,AttributeType=S \
  --key-schema AttributeName=record_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --ttl-specification AttributeName=ttl,Enabled=true

# Create worker lookup table
aws dynamodb create-table \
  --table-name biometric-workers \
  --attribute-definitions AttributeName=worker_id,AttributeType=S \
  --key-schema AttributeName=worker_id,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

#### 4. Create API Gateway

```bash
# Create REST API
API_ID=$(aws apigateway create-rest-api \
  --name biometric-sync-api \
  --description "Attendance record sync endpoint" \
  --query 'id' --output text)

# Get root resource ID
ROOT_ID=$(aws apigateway get-resources \
  --rest-api-id $API_ID \
  --query 'items[0].id' --output text)

# Create /sync resource
SYNC_RESOURCE=$(aws apigateway create-resource \
  --rest-api-id $API_ID \
  --parent-id $ROOT_ID \
  --path-part sync \
  --query 'id' --output text)

# Create POST method
aws apigateway put-method \
  --rest-api-id $API_ID \
  --resource-id $SYNC_RESOURCE \
  --http-method POST \
  --authorization-type NONE

# Integrate with Lambda
aws apigateway put-integration \
  --rest-api-id $API_ID \
  --resource-id $SYNC_RESOURCE \
  --http-method POST \
  --type AWS_PROXY \
  --integration-http-method POST \
  --uri arn:aws:apigateway:region:lambda:path/2015-03-31/functions/arn:aws:lambda:region:ACCOUNT:function:biometric-sync-production/invocations

# Deploy API
aws apigateway create-deployment \
  --rest-api-id $API_ID \
  --stage-name prod
```

#### 5. Enable CORS

```bash
# Add OPTIONS method for CORS preflight
aws apigateway put-method \
  --rest-api-id $API_ID \
  --resource-id $SYNC_RESOURCE \
  --http-method OPTIONS \
  --authorization-type NONE

# Mock integration (returns 200)
aws apigateway put-integration \
  --rest-api-id $API_ID \
  --resource-id $SYNC_RESOURCE \
  --http-method OPTIONS \
  --type MOCK \
  --request-templates '{"application/json": "{\"statusCode\": 200}"}'

# Response headers
aws apigateway put-method-response \
  --rest-api-id $API_ID \
  --resource-id $SYNC_RESOURCE \
  --http-method OPTIONS \
  --status-code 200 \
  --response-models 'application/json=Empty'
```

---

## Android App Configuration

### Update Sync Endpoint

Edit `src/index.tsx`:

```typescript
const SYNC_ENDPOINT = 'https://YOUR_API_GATEWAY_URL/prod/sync';

export const BiometricSDK = {
  // ... existing methods

  async syncPendingRecords(retryCount = 3): Promise<boolean> {
    const records = await this.getPendingRecords();
    if (records.length === 0) return true;

    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        const response = await fetch(SYNC_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records })
        });

        if (response.ok) {
          const result = await response.json();
          const successIds = result.results.successful;
          await this.markSynced(successIds);
          return true;
        }
      } catch (e) {
        console.warn(`Sync attempt ${attempt + 1} failed:`, e);
        if (attempt < retryCount - 1) {
          await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
        }
      }
    }
    return false;
  }
};
```

### Manifest Permissions

Ensure `AndroidManifest.xml` includes:

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
```

---

## Monitoring & Logs

### CloudWatch

```bash
# View Lambda logs
aws logs tail /aws/lambda/biometric-sync-production --follow

# Search for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/biometric-sync-production \
  --filter-pattern "ERROR"

# Get metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=biometric-sync-production \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Sum
```

### DynamoDB Monitoring

```bash
# Count records in table
aws dynamodb scan \
  --table-name biometric-attendance-prod \
  --select COUNT

# Find failed syncs
aws dynamodb query \
  --table-name biometric-attendance-prod \
  --index-name error_index \
  --key-condition-expression "error_flag = :true" \
  --expression-attribute-values '{":true":{"S":"true"}}'
```

### Android Logs

```bash
# Real-time logs
adb logcat | grep "DatalakeBiometric\|TFLiteEngine\|LivenessEngine"

# Save to file
adb logcat > app_logs.txt

# Filter by severity
adb logcat *:W | grep -E "DatalakeBiometric|Error|Exception"
```

---

## Security Checklist

- [ ] ATTENDANCE_SECRET rotated monthly
- [ ] API Gateway has rate limiting (100 req/s)
- [ ] Lambda has 30-second timeout (prevent hangs)
- [ ] DynamoDB Point-in-Time Recovery enabled
- [ ] VPC endpoints for DynamoDB (no internet exposure)
- [ ] CloudTrail logging for audit
- [ ] Secrets Manager for key storage
- [ ] TLS 1.2+ for all API calls

---

## Troubleshooting Deployments

### Lambda Invocation Errors

```bash
# Test Lambda directly
aws lambda invoke \
  --function-name biometric-sync-production \
  --payload '{"body":"{\"records\":[]}"}' \
  response.json

cat response.json
```

### Permission Errors

```bash
# Verify Lambda role has DynamoDB permissions
aws iam get-role-policy \
  --role-name lambda-execution-role \
  --policy-name dynamodb-access
```

### Cold Start Optimization

Add Lambda Layer with pre-installed dependencies:

```bash
# Create layer
zip -r python_layer.zip python-package/
aws lambda publish-layer-version \
  --layer-name biometric-deps \
  --zip-file fileb://python_layer.zip \
  --compatible-runtimes python3.11

# Attach to function
aws lambda update-function-configuration \
  --function-name biometric-sync-production \
  --layers arn:aws:lambda:region:account:layer:biometric-deps:1
```

---

## Cost Estimation (Monthly)

| Service | Requests/month | Estimated Cost |
|---------|---------------|----------------|
| Lambda | 100k | $2.00 |
| DynamoDB (OnDemand) | 200k writes | $1.25 |
| CloudWatch Logs | 1GB | $0.50 |
| **Total** | - | **~$3.75** |

---

## Rollback Procedures

```bash
# Rollback Lambda to previous version
aws lambda create-alias \
  --function-name biometric-sync-production \
  --name prod \
  --function-version 1

# Rollback DynamoDB schema
aws dynamodb update-table \
  --table-name biometric-attendance-prod \
  --provisioned-throughput ReadCapacityUnits=100,WriteCapacityUnits=100

# Disable API Gateway stage
aws apigateway update-stage \
  --rest-api-id $API_ID \
  --stage-name prod \
  --patch-operations op=replace,path=/*/throttle/rateLimit,value=0
```

---

**Questions?** Check ARCHITECTURE.md or file an issue.
