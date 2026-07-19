import { rename, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

type AtomicDirectoryReplacement = {
  rootDirectory: string;
  targetDirectory: string;
  stagedDirectory: string;
  backupDirectory: string;
  onCleanupError?: (error: unknown) => void;
};

function isStrictlyInside(rootDirectory: string, candidateDirectory: string): boolean {
  const relativePath = relative(resolve(rootDirectory), resolve(candidateDirectory));
  return relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath);
}

function errorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error ? String(error.code) : null;
}

export async function replaceDirectoryAtomically({
  rootDirectory,
  targetDirectory,
  stagedDirectory,
  backupDirectory,
  onCleanupError,
}: AtomicDirectoryReplacement): Promise<void> {
  if (
    !isStrictlyInside(rootDirectory, targetDirectory) ||
    !isStrictlyInside(rootDirectory, stagedDirectory) ||
    !isStrictlyInside(rootDirectory, backupDirectory)
  ) {
    throw new Error("Refusing to replace a directory outside the approved root");
  }

  let movedExistingDirectory = false;

  try {
    try {
      await rename(targetDirectory, backupDirectory);
      movedExistingDirectory = true;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }

    try {
      await rename(stagedDirectory, targetDirectory);
    } catch (installError) {
      if (movedExistingDirectory) {
        try {
          await rename(backupDirectory, targetDirectory);
          movedExistingDirectory = false;
        } catch (rollbackError) {
          throw new AggregateError(
            [installError, rollbackError],
            `Directory replacement failed and rollback is preserved at ${backupDirectory}`,
          );
        }
      }
      throw installError;
    }

    if (movedExistingDirectory) {
      await rm(backupDirectory, { recursive: true, force: true }).catch((error) => {
        onCleanupError?.(error);
      });
      movedExistingDirectory = false;
    }
  } finally {
    await rm(stagedDirectory, { recursive: true, force: true }).catch((error) => {
      onCleanupError?.(error);
    });
  }
}
