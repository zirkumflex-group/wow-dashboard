export interface AddonFileStats {
  totalBytes: number;
  createdAt: number;
  modifiedAt: number;
  totalSnapshots: number;
  totalMythicPlusRuns: number;
}

export interface PendingUploadCounts {
  snapshots: number;
  mythicPlusRuns: number;
}

export interface AddonFileState {
  pendingUploadCounts: PendingUploadCounts;
  fileStats: AddonFileStats | null;
  accountsFound: string[];
  trackedCharacters: number;
}

export interface AddonIngestResponse {
  newChars: number;
  newSnapshots: number;
  newMythicPlusRuns: number;
}

export interface AddonSyncResult extends AddonFileState {
  status: "success" | "warning";
  message: string | null;
  lastSyncedAt: number;
  lastUploadResult: AddonIngestResponse | null;
}

export interface AddonSyncError {
  message: string;
}
