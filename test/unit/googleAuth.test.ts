import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(() => true),
  },
}));

vi.mock("googleapis", () => {
  const mockGoogleAuth = vi.fn(function (this: unknown, options: unknown) {
    Object.assign(this as object, { __options: options });
  });
  return {
    google: {
      auth: {
        GoogleAuth: mockGoogleAuth,
      },
    },
  };
});

import { getGoogleAuth } from "../../src/google/auth.js";
import { google } from "googleapis";
import fs from "fs";

const SCOPES = ["https://www.googleapis.com/auth/drive.readonly"];

describe("getGoogleAuth", () => {
  const originalCredentialsJson = process.env.GOOGLE_CREDENTIALS_JSON;
  const originalCredentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GOOGLE_CREDENTIALS_JSON;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  afterEach(() => {
    if (originalCredentialsJson === undefined) {
      delete process.env.GOOGLE_CREDENTIALS_JSON;
    } else {
      process.env.GOOGLE_CREDENTIALS_JSON = originalCredentialsJson;
    }
    if (originalCredentialsPath === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = originalCredentialsPath;
    }
  });

  it("builds auth from GOOGLE_CREDENTIALS_JSON when set", () => {
    const credentials = { client_email: "sa@example.com", private_key: "fake-key" };
    process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify(credentials);

    getGoogleAuth(SCOPES);

    const mockGoogleAuth = google.auth.GoogleAuth as unknown as ReturnType<typeof vi.fn>;
    expect(mockGoogleAuth).toHaveBeenCalledWith({ credentials, scopes: SCOPES });
  });

  it("falls back to GOOGLE_APPLICATION_CREDENTIALS file path when GOOGLE_CREDENTIALS_JSON is unset", () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/fake/path/to/creds.json";

    getGoogleAuth(SCOPES);

    const mockGoogleAuth = google.auth.GoogleAuth as unknown as ReturnType<typeof vi.fn>;
    expect(mockGoogleAuth).toHaveBeenCalledWith(
      expect.objectContaining({ keyFile: expect.stringContaining("creds.json"), scopes: SCOPES })
    );
  });

  it("prefers GOOGLE_CREDENTIALS_JSON over GOOGLE_APPLICATION_CREDENTIALS when both are set", () => {
    const credentials = { client_email: "sa@example.com" };
    process.env.GOOGLE_CREDENTIALS_JSON = JSON.stringify(credentials);
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/fake/path/to/creds.json";

    getGoogleAuth(SCOPES);

    const mockGoogleAuth = google.auth.GoogleAuth as unknown as ReturnType<typeof vi.fn>;
    expect(mockGoogleAuth).toHaveBeenCalledWith({ credentials, scopes: SCOPES });
  });

  it("throws clearly when GOOGLE_CREDENTIALS_JSON is malformed JSON", () => {
    process.env.GOOGLE_CREDENTIALS_JSON = "{not valid json";

    expect(() => getGoogleAuth(SCOPES)).toThrow(/not valid JSON/);
  });

  it("throws clearly when the GOOGLE_APPLICATION_CREDENTIALS file does not exist", () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/fake/missing/creds.json";
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    expect(() => getGoogleAuth(SCOPES)).toThrow(/not found/);
  });

  it("throws clearly when neither env var is set", () => {
    expect(() => getGoogleAuth(SCOPES)).toThrow(/Neither GOOGLE_CREDENTIALS_JSON nor GOOGLE_APPLICATION_CREDENTIALS/);
  });
});
