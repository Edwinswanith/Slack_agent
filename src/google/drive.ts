import { google } from "googleapis";
import { getGoogleAuth } from "./auth.js";

export class DriveAccessError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "DriveAccessError";
  }
}

let cachedClient: ReturnType<typeof google.drive> | null = null;

export function __resetCachedClient(): void {
  cachedClient = null;
}

export async function getDriveClient() {
  if (cachedClient) {
    return cachedClient;
  }

  try {
    const auth = getGoogleAuth(["https://www.googleapis.com/auth/drive.readonly"]);

    cachedClient = google.drive({
      version: "v3",
      auth,
    });

    return cachedClient;
  } catch (error) {
    const msg =
      error instanceof Error
        ? error.message
        : "Unknown error during authentication";
    throw new DriveAccessError(
      `Failed to initialize Google Drive client: ${msg}`
    );
  }
}

export interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
}

export async function listSessionPhotos(
  folderId: string
): Promise<DriveFileInfo[]> {
  const drive = await getDriveClient();

  try {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "files(id, name, mimeType, createdTime)",
    });

    return (response.data.files ?? []).map((f) => ({
      id: f.id ?? "",
      name: f.name ?? "",
      mimeType: f.mimeType ?? "",
      createdTime: f.createdTime ?? "",
    }));
  } catch (error) {
    if (error instanceof Error) {
      const msg = error.message;
      if (msg.includes("404")) {
        throw new DriveAccessError(
          `Drive folder ${folderId} not found. Verify the folder ID is correct.`,
          404
        );
      }
      if (msg.includes("403")) {
        throw new DriveAccessError(
          `Access denied to Drive folder ${folderId}. ` +
            "Ensure the service account email is shared with the folder.",
          403
        );
      }
      throw new DriveAccessError(
        `Failed to list files in Drive folder ${folderId}: ${msg}`
      );
    }
    throw new DriveAccessError(
      `Failed to list files in Drive folder ${folderId}`
    );
  }
}

export interface PhotoVerificationResult {
  verified: boolean;
  fileCount: number;
  distinctDates: string[];
  note: string;
}

const MONTH_NAMES: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", sept: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

/**
 * Drive's createdTime is when the file was uploaded to Drive, not when the
 * photo was taken — for any batch uploaded together (the normal case), that
 * collapses every file to the same date and can never span multiple session
 * dates. Session photos are named for the date they depict (e.g. "July
 * 18.jpg"), so that filename date is the real signal; createdTime is only a
 * fallback for files that don't follow the naming convention.
 */
function extractDateFromFilename(name: string, referenceYear: string): string | null {
  const match = name.match(/([A-Za-z]+)\.?\s+(\d{1,2})/);
  if (!match) return null;
  const month = MONTH_NAMES[match[1].toLowerCase()];
  if (!month) return null;
  const day = match[2].padStart(2, "0");
  return `${referenceYear}-${month}-${day}`;
}

export function verifySessionPhotos(
  files: DriveFileInfo[],
  reportingPeriodStart: string,
  reportingPeriodEnd: string,
  minSessions: number
): PhotoVerificationResult {
  const referenceYear = reportingPeriodStart.slice(0, 4);

  const dated = files
    .filter((file) => file.mimeType.startsWith("image/"))
    .map((file) => ({
      file,
      date: extractDateFromFilename(file.name, referenceYear) ?? file.createdTime.split("T")[0],
    }));

  const imageFiles = dated
    .filter(({ date }) => date >= reportingPeriodStart && date <= reportingPeriodEnd)
    .map(({ file }) => file);

  const dateSet = new Set(
    dated.filter(({ date }) => date >= reportingPeriodStart && date <= reportingPeriodEnd).map(({ date }) => date)
  );
  const distinctDates = Array.from(dateSet).sort();

  const verified = imageFiles.length > 0 && distinctDates.length >= minSessions;

  let note: string;
  if (verified) {
    note = `${imageFiles.length} files across ${distinctDates.length} dates`;
  } else if (imageFiles.length === 0) {
    note = "no image files found in the reporting period";
  } else if (distinctDates.length < minSessions) {
    note = `only ${distinctDates.length} distinct date${distinctDates.length === 1 ? "" : "s"} found, need at least ${minSessions}`;
  } else {
    note = "verification failed";
  }

  return {
    verified,
    fileCount: imageFiles.length,
    distinctDates,
    note,
  };
}
