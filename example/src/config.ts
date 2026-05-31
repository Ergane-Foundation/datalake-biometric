/**
 * Runtime configuration for the example app.
 *
 * `SYNC_ENDPOINT` points at the deployed AWS API Gateway URL. The first
 * `deploy-backend` workflow run prints the URL in its job summary; copy that
 * string here and commit. Until then `null` keeps the Sync screen in
 * local-only mode (records get marked synced but nothing leaves the device).
 */
export const SYNC_ENDPOINT: string | null = null;
// Example after first deploy:
// export const SYNC_ENDPOINT = 'https://abc123.execute-api.ap-south-1.amazonaws.com/sync';
