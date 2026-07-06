import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getDriveClient,
  listSessionPhotos,
  verifySessionPhotos,
  DriveAccessError,
  __resetCachedClient,
} from "../../src/google/drive.js";

// Mock the googleapis module
vi.mock("googleapis", () => {
  const mockList = vi.fn();
  const mockDrive = vi.fn(() => ({
    files: {
      list: mockList,
    },
  }));

  const mockGoogleAuth = vi.fn(() => ({}));

  return {
    google: {
      drive: mockDrive,
      auth: {
        GoogleAuth: mockGoogleAuth,
      },
    },
  };
});

// Mock fs module
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
  },
}));

describe("Drive Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetCachedClient();
  });

  describe("verifySessionPhotos", () => {
    it("should verify 6 files across 2 distinct dates within reporting period", () => {
      const files = [
        {
          id: "f1",
          name: "photo1.jpg",
          mimeType: "image/jpeg",
          createdTime: "2026-07-08T10:30:00Z",
        },
        {
          id: "f2",
          name: "photo2.jpg",
          mimeType: "image/jpeg",
          createdTime: "2026-07-08T11:45:00Z",
        },
        {
          id: "f3",
          name: "photo3.jpg",
          mimeType: "image/jpeg",
          createdTime: "2026-07-22T14:20:00Z",
        },
        {
          id: "f4",
          name: "photo4.jpg",
          mimeType: "image/jpeg",
          createdTime: "2026-07-22T15:30:00Z",
        },
        {
          id: "f5",
          name: "photo5.jpg",
          mimeType: "image/jpeg",
          createdTime: "2026-07-22T16:15:00Z",
        },
        {
          id: "f6",
          name: "photo6.jpg",
          mimeType: "image/jpeg",
          createdTime: "2026-07-22T17:00:00Z",
        },
      ];

      const result = verifySessionPhotos(
        files,
        "2026-07-01",
        "2026-07-31",
        2
      );

      expect(result.verified).toBe(true);
      expect(result.fileCount).toBe(6);
      expect(result.distinctDates).toEqual(["2026-07-08", "2026-07-22"]);
      expect(result.note).toBe("6 files across 2 dates");
    });

    it("should exclude non-image files", () => {
      const files = [
        {
          id: "f1",
          name: "photo1.jpg",
          mimeType: "image/jpeg",
          createdTime: "2026-07-08T10:30:00Z",
        },
        {
          id: "f2",
          name: "document.pdf",
          mimeType: "application/pdf",
          createdTime: "2026-07-08T11:45:00Z",
        },
        {
          id: "f3",
          name: "photo2.jpg",
          mimeType: "image/jpeg",
          createdTime: "2026-07-22T14:20:00Z",
        },
      ];

      const result = verifySessionPhotos(
        files,
        "2026-07-01",
        "2026-07-31",
        2
      );

      expect(result.fileCount).toBe(2);
      expect(result.verified).toBe(true);
    });

    it("should read the session date from the filename, not the Drive upload timestamp", () => {
      // Real-world case: every file is uploaded to Drive in the same batch,
      // so createdTime is identical for all of them — the actual session
      // date only lives in the filename (e.g. "July 18.jpg").
      const files = [
        { id: "f1", name: "July 8.jpeg", mimeType: "image/jpeg", createdTime: "2026-07-06T14:20:04.523Z" },
        { id: "f2", name: "July 18.jpg", mimeType: "image/jpeg", createdTime: "2026-07-06T14:20:02.698Z" },
        { id: "f3", name: "July 20.jpg", mimeType: "image/jpeg", createdTime: "2026-07-06T14:20:02.690Z" },
      ];

      const result = verifySessionPhotos(files, "2026-07-01", "2026-07-31", 2);

      expect(result.verified).toBe(true);
      expect(result.distinctDates).toEqual(["2026-07-08", "2026-07-18", "2026-07-20"]);
    });

    it("should fall back to the Drive upload timestamp when the filename has no parseable date", () => {
      const files = [
        { id: "f1", name: "IMG_0001.jpg", mimeType: "image/jpeg", createdTime: "2026-07-08T10:30:00Z" },
        { id: "f2", name: "IMG_0002.jpg", mimeType: "image/jpeg", createdTime: "2026-07-22T14:20:00Z" },
      ];

      const result = verifySessionPhotos(files, "2026-07-01", "2026-07-31", 2);

      expect(result.verified).toBe(true);
      expect(result.distinctDates).toEqual(["2026-07-08", "2026-07-22"]);
    });

    it("should return not verified when distinctDates < minSessions", () => {
      const files = [
        {
          id: "f1",
          name: "photo1.jpg",
          mimeType: "image/jpeg",
          createdTime: "2026-07-08T10:30:00Z",
        },
      ];

      const result = verifySessionPhotos(
        files,
        "2026-07-01",
        "2026-07-31",
        3
      );

      expect(result.verified).toBe(false);
      expect(result.fileCount).toBe(1);
      expect(result.note).toContain("only 1 distinct date");
      expect(result.note).toContain("need at least 3");
    });
  });

  describe("DriveAccessError", () => {
    it("should be instantiable with a message and optional status code", () => {
      const error1 = new DriveAccessError("Test error");
      expect(error1.message).toBe("Test error");
      expect(error1.statusCode).toBeUndefined();
      expect(error1.name).toBe("DriveAccessError");

      const error2 = new DriveAccessError("Access denied", 403);
      expect(error2.message).toBe("Access denied");
      expect(error2.statusCode).toBe(403);
    });

    it("should be catchable as an Error", () => {
      const error = new DriveAccessError("Test");
      expect(error instanceof Error).toBe(true);
      expect(error instanceof DriveAccessError).toBe(true);
    });
  });
});
