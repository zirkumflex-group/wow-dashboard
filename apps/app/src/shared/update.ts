export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "upToDate"
  | "error"
  | "unsupported";

export interface AppUpdateState {
  status: AppUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  progressPercent: number | null;
  error: string | null;
  lastCheckedAt: number | null;
  isPackaged: boolean;
}

export interface AppInstallUpdateResult {
  ok: boolean;
  status: "installing" | "notDownloaded" | "unsupported";
  message: string | null;
}

export type AddonUpdateStatus =
  | "idle"
  | "checking"
  | "updating"
  | "upToDate"
  | "staged"
  | "applied"
  | "notInstalled"
  | "noRetailPath"
  | "invalidRetailPath"
  | "error";

export interface AddonUpdateState {
  status: AddonUpdateStatus;
  installedVersion: string | null;
  latestVersion: string | null;
  stagedVersion: string | null;
  error: string | null;
  lastCheckedAt: number | null;
}

export interface AddonUpdateCheckResult {
  status:
    | "upToDate"
    | "staged"
    | "applied"
    | "notInstalled"
    | "noRetailPath"
    | "invalidRetailPath"
    | "error";
  installedVersion: string | null;
  latestVersion: string | null;
  stagedVersion: string | null;
  error: string | null;
}

export interface AddonApplyStagedResult {
  outcome: "applied" | "notReady" | "retryableError" | "fatalError";
  error: string | null;
  stagedVersion: string | null;
}
