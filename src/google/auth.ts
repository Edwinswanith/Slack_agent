import { google } from "googleapis";
import fs from "fs";
import path from "path";

/**
 * Builds an authenticated GoogleAuth instance for the given scopes.
 *
 * Prefers GOOGLE_CREDENTIALS_JSON (a full service-account JSON key, passed
 * in-memory — needed on hosts like Railway that have no writable secret-file
 * mount) over GOOGLE_APPLICATION_CREDENTIALS (a file path — used in local
 * dev). If both are set, GOOGLE_CREDENTIALS_JSON wins.
 *
 * Throws a plain Error (not a domain-specific error type) if neither env var
 * is set, the JSON is malformed, or the file path does not exist — callers
 * catch and re-wrap this as their own SheetAccessError/DriveAccessError so
 * existing `instanceof` checks elsewhere in the codebase keep working.
 */
export function getGoogleAuth(scopes: string[]): InstanceType<typeof google.auth.GoogleAuth> {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
  if (credentialsJson) {
    let credentials: object;
    try {
      credentials = JSON.parse(credentialsJson);
    } catch {
      throw new Error(
        "GOOGLE_CREDENTIALS_JSON is not valid JSON. " +
          "Set it to the full contents of your service account key file."
      );
    }
    return new google.auth.GoogleAuth({ credentials, scopes });
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new Error(
      "Neither GOOGLE_CREDENTIALS_JSON nor GOOGLE_APPLICATION_CREDENTIALS is set. " +
        "Set one of them to authenticate with Google APIs."
    );
  }

  const resolvedPath = path.resolve(credPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Service account credentials file not found at ${resolvedPath}. ` +
        "Ensure GOOGLE_APPLICATION_CREDENTIALS points to a valid file."
    );
  }

  return new google.auth.GoogleAuth({ keyFile: resolvedPath, scopes });
}
