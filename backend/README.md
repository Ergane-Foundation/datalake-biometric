# Sync backend (optional, self-hosted)

The SDK works fully offline and never needs this. Use it only if you want to
collect attendance records from devices in one place. You deploy it into **your
own** AWS account; this project does not run a shared server.

## What it creates

- An HTTP API with one route, `POST /sync`, protected by a bearer token and
  rate limited (10 requests per second, bursts of 20).
- `authorizer.py`: checks the token against an SSM Parameter Store value.
- `lambda_sync_handler.py`: validates records and writes them to DynamoDB.
  Retried uploads are reported as `duplicate`, never stored twice.
- A DynamoDB table (encrypted, point-in-time recovery on) where records expire
  after 90 days.

Request and response formats are documented at the top of `lambda_sync_handler.py`.

## Costs

Pay per request, no fixed monthly cost for the API, functions or table. Small
deployments often fit in the AWS free tier, but check current AWS pricing for
your region and volume.

## 1. Create the access token

Create a long random token and store it as a SecureString. Do not commit it.

macOS or Linux:

```sh
aws ssm put-parameter --name /datalake-biometric/sync-token --type SecureString \
  --value "$(openssl rand -base64 32)"
```

Windows PowerShell:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
aws ssm put-parameter --name /datalake-biometric/sync-token --type SecureString --value ([Convert]::ToBase64String($bytes))
```

To read it later (for entering it in the app):
`aws ssm get-parameter --name /datalake-biometric/sync-token --with-decryption`

To rotate it, run `put-parameter` again with `--overwrite`. The authorizer picks
up the new value within five minutes.

## 2. Deploy from your computer

Needs the AWS CLI and the AWS SAM CLI, logged in to your account.

```sh
cd backend
sam build
sam deploy            # stack name and region come from samconfig.toml; edit them first
```

The output `ApiUrl` is the endpoint to enter on the example app's Sync screen,
together with the token.

## 3. Or deploy from GitHub Actions

`.github/workflows/deploy-backend.yml` only runs when started by hand (Actions
tab, "Deploy backend", "Run workflow"), and only in the repository named in its
`if:` line. Forks and pull requests can never deploy.

### Option A: OpenID Connect (recommended)

GitHub gets short-lived AWS credentials for each run, so no AWS key is stored
in GitHub.

1. In AWS IAM, add an identity provider: OpenID Connect, URL
   `https://token.actions.githubusercontent.com`, audience `sts.amazonaws.com`.
2. Create a role that trusts it, limited to your repository's main branch:

   ```json
   {
     "Effect": "Allow",
     "Principal": { "Federated": "arn:aws:iam::<account-id>:oidc-provider/token.actions.githubusercontent.com" },
     "Action": "sts:AssumeRoleWithWebIdentity",
     "Condition": {
       "StringEquals": {
         "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
         "token.actions.githubusercontent.com:sub": "repo:<owner>/<repo>:ref:refs/heads/main"
       }
     }
   }
   ```

3. Give the role the permissions SAM needs to deploy this stack: CloudFormation,
   the SAM artifact S3 bucket, Lambda, API Gateway, DynamoDB and IAM roles for
   the functions. Start narrow and widen only when a deploy fails.
4. In the GitHub repository, add two variables (Settings, Secrets and variables,
   Actions, Variables): `AWS_DEPLOY_ROLE_ARN` and `AWS_REGION`.

### Option B: access keys

Simpler, but a long-lived key is stored in GitHub. Create an IAM user with the
permissions above, add `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as
repository **secrets**, and in the workflow replace `role-to-assume` with:

```yaml
aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

Also remove `id-token: write` from the workflow's permissions. Rotate the key
regularly and delete it when no longer needed.

## Tests

```sh
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
python -m pytest
```

The tests use fakes for DynamoDB and SSM, so they need no AWS account.

## Removing it

```sh
aws cloudformation delete-stack --stack-name <stack-name> --region <region>
aws ssm delete-parameter --name /datalake-biometric/sync-token
```

The DynamoDB table and its data are deleted with the stack.
