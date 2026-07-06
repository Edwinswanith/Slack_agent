import { google } from "googleapis";
import fs from "fs";
import path from "path";

/**
 * Custom error for sheet access failures.
 * Distinguishes from other errors so callers can provide specific messaging.
 */
export class SheetAccessError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "SheetAccessError";
  }
}

/**
 * Lazy-loaded Sheets API client.
 * Initialized on first call to getSheetsClient().
 */
let cachedClient: ReturnType<typeof google.sheets> | null = null;

/**
 * Internal: Reset cached client. Used for testing only.
 */
export function __resetCachedClient() {
  cachedClient = null;
}

/**
 * Initializes and returns the authenticated Google Sheets API v4 client.
 *
 * Authenticates using a service account JSON key file via GOOGLE_APPLICATION_CREDENTIALS
 * environment variable. Requests read-only scope only (https://www.googleapis.com/auth/spreadsheets.readonly).
 *
 * Fails fast if:
 * - GOOGLE_APPLICATION_CREDENTIALS is unset
 * - The credential file does not exist
 * - Authentication fails
 *
 * @returns The authenticated sheets API client
 * @throws {SheetAccessError} If credentials are missing or invalid
 */
export async function getSheetsClient() {
  // Return cached client if already initialized
  if (cachedClient) {
    return cachedClient;
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) {
    throw new SheetAccessError(
      "GOOGLE_APPLICATION_CREDENTIALS environment variable is not set. " +
        "Set it to the path of your service account JSON key file."
    );
  }

  // Resolve to absolute path for clarity in error messages
  const resolvedPath = path.resolve(credPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new SheetAccessError(
      `Service account credentials file not found at ${resolvedPath}. ` +
        "Ensure GOOGLE_APPLICATION_CREDENTIALS points to a valid file."
    );
  }

  try {
    // Initialize GoogleAuth with the service account key file
    const auth = new google.auth.GoogleAuth({
      keyFile: resolvedPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    // Create the sheets API client
    cachedClient = google.sheets({
      version: "v4",
      auth,
    });

    return cachedClient;
  } catch (error) {
    const msg =
      error instanceof Error
        ? error.message
        : "Unknown error during authentication";
    throw new SheetAccessError(
      `Failed to initialize Google Sheets client: ${msg}`
    );
  }
}

/**
 * Reads a range of cells from a sheet.
 *
 * @param sheetId The spreadsheet ID (from the sheet URL)
 * @param range The range in A1 notation, e.g. "Sheet1!A1:B10" or "Roster!A:B"
 * @returns A 2D array of cell values (rows x columns)
 * @throws {SheetAccessError} If the sheet is unreachable or access is denied
 */
export async function readRange(sheetId: string, range: string): Promise<(string | number | boolean | null)[][]> {
  const sheets = await getSheetsClient();

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range,
    });

    // Return empty array if no data found
    if (!response.data.values) {
      return [];
    }

    return response.data.values;
  } catch (error) {
    // Handle specific Google API errors
    if (error instanceof Error) {
      const msg = error.message;
      if (msg.includes("404")) {
        throw new SheetAccessError(
          `Sheet with ID ${sheetId} not found. Verify the sheet ID is correct.`,
          404
        );
      }
      if (msg.includes("403")) {
        throw new SheetAccessError(
          `Access denied to sheet ${sheetId}. Ensure the service account email ` +
            "is shared with the sheet.",
          403
        );
      }
      throw new SheetAccessError(
        `Failed to read range "${range}" from sheet ${sheetId}: ${msg}`
      );
    }
    throw new SheetAccessError(`Failed to read range "${range}" from sheet ${sheetId}`);
  }
}

/**
 * Typed snapshot of the demo attendance tracker sheet.
 * Mirrors PRD §14.2 structure: Sessions, Roster, and Summary tabs.
 */
export interface AttendanceTrackerSnapshot {
  sessionCounts: number[]; // 8 per-session values from Sessions tab (W1-W8)
  sessionCellRefs: string[]; // "Sessions!A{row}:B{row}" for each of the 8 sessions, same order as sessionCounts
  sessionSum: number; // Sum of sessionCounts
  workshopCount: number; // Total workshop count
  workshopCountCellRef: string; // Cell ref for the workshop count row
  uniqueStudents: number; // Unique students from Roster tab
  uniqueStudentsCellRef: string; // Cell ref for the unique-students row
  summaryStudentsServedValue: number; // Value from Summary tab labeled "Students served"
  summaryStudentsServedCellRef: string; // Cell ref for the "Students served" row
}

/**
 * Reads the three tabs from the Youth Literacy Attendance Tracker sheet
 * and returns a typed snapshot for evidence extraction.
 *
 * Parses by finding rows whose label text matches expected patterns
 * (e.g., a cell containing "Unique students enrolled") rather than
 * hardcoding exact cell addresses. This allows the sheet structure
 * to change slightly without breaking parsing.
 *
 * @param sheetId The spreadsheet ID
 * @returns A typed snapshot of the attendance tracker data
 * @throws {SheetAccessError} If the sheet cannot be read or is missing required data
 */
/**
 * Sheets can return numeric cells as JS numbers or as numeric strings,
 * depending on the cell's format (e.g. a column formatted as Plain text).
 * Coerce either into a number, or return null if not numeric.
 */
function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && !isNaN(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}

export async function readAttendanceTrackerSnapshot(
  sheetId: string
): Promise<AttendanceTrackerSnapshot> {
  // Read generous ranges from each tab to tolerate minor layout shifts
  const [sessionsData, rosterData, summaryData] = await Promise.all([
    readRange(sheetId, "Sessions!A1:C20"),
    readRange(sheetId, "Roster!A1:C10"),
    readRange(sheetId, "Summary!A1:C20"),
  ]);

  // Extract session counts from the Sessions tab
  // Expected structure: column A = week label (W1, W2, etc.), column B = count
  // Row index (0-based) + 1 gives the 1-based sheet row for cell references.
  const sessionCounts: number[] = [];
  const sessionCellRefs: string[] = [];
  for (let i = 0; i < sessionsData.length; i++) {
    const row = sessionsData[i];
    const sheetRow = i + 1;
    if (row.length >= 2) {
      const label = String(row[0] ?? "").trim();
      const value = toNumberOrNull(row[1]);
      // Match week labels W1, W2, etc.
      if (label.match(/^W\d+$/i) && value !== null) {
        sessionCounts.push(value);
        sessionCellRefs.push(`Sessions!B${sheetRow}`);
      } else if (value !== null && label.match(/^W\d+$/i) === null && label !== "") {
        // Handle case where label is non-week but value is numeric (fallback parsing)
        // Only if we haven't found 8 sessions yet
        if (sessionCounts.length < 8) {
          sessionCounts.push(value);
          sessionCellRefs.push(`Sessions!B${sheetRow}`);
        }
      }
    }
  }

  if (sessionCounts.length !== 8) {
    throw new SheetAccessError(
      `Expected 8 session counts from Sessions tab, found ${sessionCounts.length}. ` +
        "Verify the Sessions tab structure matches PRD §14.2."
    );
  }

  const sessionSum = sessionCounts.reduce((a, b) => a + b, 0);

  // Extract workshop count from Sessions tab (cell B10 in the demo, but search for it)
  let workshopCount = sessionCounts.length; // Default to number of sessions
  let workshopCountCellRef = "";
  for (let i = 0; i < sessionsData.length; i++) {
    const row = sessionsData[i];
    if (row.length >= 2) {
      const label = String(row[0] ?? "").toLowerCase();
      const value = toNumberOrNull(row[1]);
      if (label.includes("workshop") && value !== null) {
        workshopCount = value;
        workshopCountCellRef = `Sessions!B${i + 1}`;
        break;
      }
    }
  }

  // Extract unique students from Roster tab
  // Expected: a row with "Unique students enrolled" or similar, with the count in the next column
  let uniqueStudents = 0;
  let uniqueStudentsCellRef = "";
  for (let i = 0; i < rosterData.length; i++) {
    const row = rosterData[i];
    if (row.length >= 2) {
      const label = String(row[0] ?? "").toLowerCase();
      const value = toNumberOrNull(row[1]);
      if ((label.includes("unique") || label.includes("enrolled")) && value !== null) {
        uniqueStudents = value;
        uniqueStudentsCellRef = `Roster!B${i + 1}`;
        break;
      }
    }
  }

  if (uniqueStudents === 0) {
    throw new SheetAccessError(
      "Could not find unique student count in Roster tab. " +
        "Ensure a cell containing 'Unique students' is present."
    );
  }

  // Extract students served value from Summary tab
  // Expected: a row with "Students served" or similar, with the count in the next column
  let summaryStudentsServedValue = 0;
  let summaryStudentsServedCellRef = "";
  for (let i = 0; i < summaryData.length; i++) {
    const row = summaryData[i];
    if (row.length >= 2) {
      const label = String(row[0] ?? "").toLowerCase();
      const value = toNumberOrNull(row[1]);
      if (label.includes("students") && label.includes("served") && value !== null) {
        summaryStudentsServedValue = value;
        summaryStudentsServedCellRef = `Summary!B${i + 1}`;
        break;
      }
    }
  }

  if (summaryStudentsServedValue === 0) {
    throw new SheetAccessError(
      "Could not find 'Students served' value in Summary tab. " +
        "Ensure a cell with this label is present."
    );
  }

  return {
    sessionCounts,
    sessionCellRefs,
    sessionSum,
    workshopCount,
    workshopCountCellRef,
    uniqueStudents,
    uniqueStudentsCellRef,
    summaryStudentsServedValue,
    summaryStudentsServedCellRef,
  };
}
