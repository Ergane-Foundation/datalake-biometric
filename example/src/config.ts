// SPDX-License-Identifier: Apache-2.0
/**
 * Example app configuration.
 *
 * Sync is optional. The SDK works fully offline; the Sync screen only uploads
 * queued records when you deploy your own backend (see backend/README.md) and
 * enter its URL and access token on that screen at runtime.
 *
 * Do not commit a real endpoint or token here. `DEFAULT_SYNC_ENDPOINT` only
 * pre-fills the URL field, for local convenience.
 */
export const DEFAULT_SYNC_ENDPOINT: string | null = null;
