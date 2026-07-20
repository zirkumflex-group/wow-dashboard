import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface AuthTokenCipher {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(value: string): Promise<Buffer>;
  decryptStringAsync(value: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

export type AuthTokenSaveResult = "saved" | "removed" | "encryption-unavailable" | "failed";

function readSessionToken(raw: string): { token: string | null; legacy: boolean } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { token: null, legacy: false };
    }

    const sessionToken = (parsed as { sessionToken?: unknown }).sessionToken;
    return {
      token: typeof sessionToken === "string" && sessionToken.trim() ? sessionToken.trim() : null,
      legacy: false,
    };
  } catch {
    const token = raw.trim();
    return {
      token: token || null,
      legacy: Boolean(token),
    };
  }
}

export async function loadEncryptedSessionToken(
  tokenPath: string,
  cipher: AuthTokenCipher,
): Promise<string | null> {
  try {
    const encrypted = await readFile(tokenPath);
    if (!(await cipher.isAsyncEncryptionAvailable())) return null;

    const decrypted = await cipher.decryptStringAsync(encrypted);
    const stored = readSessionToken(decrypted.result);
    if (!stored.token) return null;

    if (stored.legacy || decrypted.shouldReEncrypt) {
      await saveEncryptedSessionToken(tokenPath, stored.token, cipher);
    }

    return stored.token;
  } catch {
    return null;
  }
}

export async function saveEncryptedSessionToken(
  tokenPath: string,
  token: string | null,
  cipher: AuthTokenCipher,
): Promise<AuthTokenSaveResult> {
  // Logout must remove an existing credential even if the OS keychain is
  // temporarily unavailable. Otherwise a future launch could restore it.
  if (!token) {
    try {
      await rm(tokenPath, { force: true });
      return "removed";
    } catch {
      return "failed";
    }
  }

  try {
    if (!(await cipher.isAsyncEncryptionAvailable())) return "encryption-unavailable";
  } catch {
    return "encryption-unavailable";
  }

  const temporaryPath = `${tokenPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const encrypted = await cipher.encryptStringAsync(JSON.stringify({ sessionToken: token }));
    await mkdir(dirname(tokenPath), { recursive: true });
    await writeFile(temporaryPath, encrypted, { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, tokenPath);
    await chmod(tokenPath, 0o600);
    return "saved";
  } catch {
    try {
      await rm(temporaryPath, { force: true });
    } catch {
      // Best-effort cleanup; the prior credential remains authoritative.
    }
    return "failed";
  }
}
