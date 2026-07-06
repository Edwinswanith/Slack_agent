import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock GOOGLE_APPLICATION_CREDENTIALS environment variable
process.env.GOOGLE_APPLICATION_CREDENTIALS = "/fake/path/to/creds.json";

// Mock fs BEFORE importing sheets
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
    readFileSync: vi.fn(),
  },
}));

// Mock googleapis BEFORE importing sheets
vi.mock("googleapis", () => {
  const mockGet = vi.fn();
  return {
    google: {
      sheets: vi.fn(() => ({
        spreadsheets: {
          values: {
            get: mockGet,
          },
        },
      })),
      auth: {
        GoogleAuth: vi.fn(function() {
          // Constructor function that does nothing
        }),
      },
    },
  };
});

// Now import the sheets module after mocks are in place
import {
  getSheetsClient,
  readRange,
  readAttendanceTrackerSnapshot,
  SheetAccessError,
  __resetCachedClient,
} from "../../src/google/sheets";
import { google } from "googleapis";

describe("Sheets Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCachedClient();
  });

  describe("readAttendanceTrackerSnapshot", () => {
    it("should correctly parse demo data matching PRD §14.2 (W1-W8: 51,55,49,58,52,57,61,49)", async () => {
      // Sessions tab response: W1-W8 with counts
      const sessionsData = [
        ["Week", "Count", "Notes"],
        ["W1", 51, ""],
        ["W2", 55, ""],
        ["W3", 49, ""],
        ["W4", 58, ""],
        ["W5", 52, ""],
        ["W6", 57, ""],
        ["W7", 61, ""],
        ["W8", 49, ""],
        ["Total Workshops", 8, ""],
      ];

      // Roster tab response: 61 unique students
      const rosterData = [
        ["Student ID", "Name", "Sessions"],
        ["S001", "Student 1", 3],
        ["Unique students enrolled", 61, ""],
      ];

      // Summary tab response: 432 students served (the planted landmine)
      const summaryData = [
        ["Metric", "Value", ""],
        ["Workshop Count", 8, ""],
        ["Students served (July)", 432, ""],
      ];

      // Get the mocked sheets client and configure it
      const mockSheetsClient = google.sheets as any;
      const mockInstance = {
        spreadsheets: {
          values: {
            get: vi.fn().mockImplementation(async ({ range }) => {
              if (range.includes("Sessions")) {
                return { data: { values: sessionsData } };
              }
              if (range.includes("Roster")) {
                return { data: { values: rosterData } };
              }
              if (range.includes("Summary")) {
                return { data: { values: summaryData } };
              }
              return { data: { values: [] } };
            }),
          },
        },
      };
      mockSheetsClient.mockReturnValue(mockInstance);

      const result = await readAttendanceTrackerSnapshot("test-sheet-id");

      // Verify the parsed data matches PRD §14.2 exactly
      expect(result.sessionCounts).toEqual([51, 55, 49, 58, 52, 57, 61, 49]);
      expect(result.sessionSum).toBe(432);
      expect(result.workshopCount).toBe(8);
      expect(result.uniqueStudents).toBe(61);
      expect(result.summaryStudentsServedValue).toBe(432);
    });

    it("should throw SheetAccessError when a 403 (access denied) occurs", async () => {
      const mockSheetsClient = google.sheets as any;
      
      // Configure to reject on all calls
      const mockInstance = {
        spreadsheets: {
          values: {
            get: vi.fn().mockImplementation(async ({ range }) => {
              // Return error for any call
              throw new Error("403: Forbidden - The caller does not have permission");
            }),
          },
        },
      };
      mockSheetsClient.mockReturnValue(mockInstance);

      await expect(readAttendanceTrackerSnapshot("test-sheet-id")).rejects.toThrow(
        SheetAccessError
      );
      await expect(readAttendanceTrackerSnapshot("test-sheet-id")).rejects.toThrow(
        /Access denied/
      );
    });

    it("should throw SheetAccessError when Sessions tab has fewer than 8 sessions", async () => {
      // Sessions tab with only 7 sessions (missing W8)
      const sessionsData = [
        ["Week", "Count", "Notes"],
        ["W1", 51, ""],
        ["W2", 55, ""],
        ["W3", 49, ""],
        ["W4", 58, ""],
        ["W5", 52, ""],
        ["W6", 57, ""],
        ["W7", 61, ""],
      ];

      const rosterData = [["Unique students enrolled", 61, ""]];
      const summaryData = [["Students served (July)", 432, ""]];

      const mockSheetsClient = google.sheets as any;
      
      const mockInstance = {
        spreadsheets: {
          values: {
            get: vi.fn().mockImplementation(async ({ range }) => {
              if (range.includes("Sessions")) {
                return { data: { values: sessionsData } };
              }
              if (range.includes("Roster")) {
                return { data: { values: rosterData } };
              }
              if (range.includes("Summary")) {
                return { data: { values: summaryData } };
              }
              return { data: { values: [] } };
            }),
          },
        },
      };
      mockSheetsClient.mockReturnValue(mockInstance);

      await expect(readAttendanceTrackerSnapshot("test-sheet-id")).rejects.toThrow(
        /Expected 8 session counts/
      );
    });

    it("should throw SheetAccessError when Roster unique student count is missing", async () => {
      const sessionsData = [
        ["Week", "Count"],
        ["W1", 51],
        ["W2", 55],
        ["W3", 49],
        ["W4", 58],
        ["W5", 52],
        ["W6", 57],
        ["W7", 61],
        ["W8", 49],
      ];

      // Roster without the unique student count row
      const rosterData = [["Student ID", "Name"]];

      const summaryData = [["Students served (July)", 432]];

      const mockSheetsClient = google.sheets as any;
      
      const mockInstance = {
        spreadsheets: {
          values: {
            get: vi.fn().mockImplementation(async ({ range }) => {
              if (range.includes("Sessions")) {
                return { data: { values: sessionsData } };
              }
              if (range.includes("Roster")) {
                return { data: { values: rosterData } };
              }
              if (range.includes("Summary")) {
                return { data: { values: summaryData } };
              }
              return { data: { values: [] } };
            }),
          },
        },
      };
      mockSheetsClient.mockReturnValue(mockInstance);

      await expect(readAttendanceTrackerSnapshot("test-sheet-id")).rejects.toThrow(
        /Could not find unique student count/
      );
    });

    it("EVALS.md C4 — a planted roster name never appears anywhere in the returned snapshot", async () => {
      const sessionsData = [
        ["Week", "Count"],
        ["W1", 51],
        ["W2", 55],
        ["W3", 49],
        ["W4", 58],
        ["W5", 52],
        ["W6", 57],
        ["W7", 61],
        ["W8", 49],
        ["Total Workshops", 8],
      ];

      // Roster tab with individual child names planted alongside the aggregate count,
      // mirroring PRD §14.2's real sheet structure.
      const plantedName = "Meena Priyadarshini";
      const rosterData = [
        ["Student ID", "Name", "Sessions"],
        ["S001", plantedName, 3],
        ["S002", "Kavya Elangovan", 5],
        ["Unique students enrolled", 61, ""],
      ];

      const summaryData = [["Students served (July)", 432]];

      const mockSheetsClient = google.sheets as any;

      const mockInstance = {
        spreadsheets: {
          values: {
            get: vi.fn().mockImplementation(async ({ range }) => {
              if (range.includes("Sessions")) {
                return { data: { values: sessionsData } };
              }
              if (range.includes("Roster")) {
                return { data: { values: rosterData } };
              }
              if (range.includes("Summary")) {
                return { data: { values: summaryData } };
              }
              return { data: { values: [] } };
            }),
          },
        },
      };
      mockSheetsClient.mockReturnValue(mockInstance);

      const result = await readAttendanceTrackerSnapshot("test-sheet-id");

      // The aggregate count must still come through correctly...
      expect(result.uniqueStudents).toBe(61);
      // ...but no individual roster name may leak into any field of the snapshot
      // (PRD §9.1/§10, EVALS.md C4: "agent cites the count cell only").
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(plantedName);
      expect(serialized).not.toContain("Meena");
      expect(serialized).not.toContain("Kavya Elangovan");
    });

    it("should throw SheetAccessError when Summary 'Students served' value is missing", async () => {
      const sessionsData = [
        ["Week", "Count"],
        ["W1", 51],
        ["W2", 55],
        ["W3", 49],
        ["W4", 58],
        ["W5", 52],
        ["W6", 57],
        ["W7", 61],
        ["W8", 49],
      ];

      const rosterData = [["Unique students enrolled", 61]];

      // Summary without the "Students served" row
      const summaryData = [["Metric", "Value"]];

      const mockSheetsClient = google.sheets as any;
      
      const mockInstance = {
        spreadsheets: {
          values: {
            get: vi.fn().mockImplementation(async ({ range }) => {
              if (range.includes("Sessions")) {
                return { data: { values: sessionsData } };
              }
              if (range.includes("Roster")) {
                return { data: { values: rosterData } };
              }
              if (range.includes("Summary")) {
                return { data: { values: summaryData } };
              }
              return { data: { values: [] } };
            }),
          },
        },
      };
      mockSheetsClient.mockReturnValue(mockInstance);

      await expect(readAttendanceTrackerSnapshot("test-sheet-id")).rejects.toThrow(
        /Could not find 'Students served'/
      );
    });
  });

  describe("SheetAccessError", () => {
    it("should be instantiable with a message and optional status code", () => {
      const error1 = new SheetAccessError("Test error");
      expect(error1.message).toBe("Test error");
      expect(error1.statusCode).toBeUndefined();
      expect(error1.name).toBe("SheetAccessError");

      const error2 = new SheetAccessError("Access denied", 403);
      expect(error2.message).toBe("Access denied");
      expect(error2.statusCode).toBe(403);
    });

    it("should be catchable as an Error", () => {
      const error = new SheetAccessError("Test");
      expect(error instanceof Error).toBe(true);
      expect(error instanceof SheetAccessError).toBe(true);
    });
  });
});
