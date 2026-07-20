import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  loadEncryptedSessionToken,
  saveEncryptedSessionToken,
  type AuthTokenCipher,
} from "./authTokenStorage";

const temporaryRoots: string[] = [];

function testCipher(options: { available?: boolean; failEncryption?: boolean } = {}) {
  return {
    isAsyncEncryptionAvailable: async () => options.available ?? true,
    encryptStringAsync: async (value: string) => {
      if (options.failEncryption) throw new Error("encryption failed");
      return Buffer.from(`encrypted:${value}`, "utf8");
    },
    decryptStringAsync: async (value: Buffer) => {
      const raw = value.toString("utf8");
      if (!raw.startsWith("encrypted:")) throw new Error("invalid ciphertext");
      return {
        result: raw.slice("encrypted:".length),
        shouldReEncrypt: false,
      };
    },
  } satisfies AuthTokenCipher;
}

async function createTokenPath() {
  const directory = await mkdtemp(join(tmpdir(), "wow-dashboard-auth-token-"));
  temporaryRoots.push(directory);
  return join(directory, "auth-token.bin");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("encrypted desktop auth token storage", () => {
  it("atomically saves and restores an encrypted token with private permissions", async () => {
    const tokenPath = await createTokenPath();
    const cipher = testCipher();

    assert.equal(await saveEncryptedSessionToken(tokenPath, "session-token", cipher), "saved");
    assert.equal(await loadEncryptedSessionToken(tokenPath, cipher), "session-token");
    assert.doesNotMatch((await readFile(tokenPath)).toString("utf8"), /session-token$/);

    if (process.platform !== "win32") {
      assert.equal((await stat(tokenPath)).mode & 0o777, 0o600);
    }
  });

  it("migrates the prior raw encrypted token format", async () => {
    const tokenPath = await createTokenPath();
    const cipher = testCipher();
    await writeFile(tokenPath, await cipher.encryptStringAsync("legacy-session-token"));

    assert.equal(await loadEncryptedSessionToken(tokenPath, cipher), "legacy-session-token");
    const migrated = await cipher.decryptStringAsync(await readFile(tokenPath));
    assert.deepEqual(JSON.parse(migrated.result), {
      sessionToken: "legacy-session-token",
    });
  });

  it("removes a stored credential on logout even when encryption is unavailable", async () => {
    const tokenPath = await createTokenPath();
    await writeFile(tokenPath, "existing-encrypted-value");

    assert.equal(
      await saveEncryptedSessionToken(tokenPath, null, testCipher({ available: false })),
      "removed",
    );
    await assert.rejects(readFile(tokenPath), { code: "ENOENT" });
  });

  it("leaves the previous credential intact when a replacement cannot be encrypted", async () => {
    const tokenPath = await createTokenPath();
    const cipher = testCipher();
    assert.equal(await saveEncryptedSessionToken(tokenPath, "old-token", cipher), "saved");
    const before = await readFile(tokenPath);

    assert.equal(
      await saveEncryptedSessionToken(tokenPath, "new-token", testCipher({ failEncryption: true })),
      "failed",
    );
    assert.deepEqual(await readFile(tokenPath), before);
    assert.equal(await loadEncryptedSessionToken(tokenPath, cipher), "old-token");
  });

  it("re-encrypts a stored credential when the OS rotates its encryption key", async () => {
    const tokenPath = await createTokenPath();
    const baseCipher = testCipher();
    await writeFile(tokenPath, await baseCipher.encryptStringAsync('{"sessionToken":"token"}'));

    let encryptionCount = 0;
    const rotatingCipher: AuthTokenCipher = {
      ...baseCipher,
      decryptStringAsync: async (value) => ({
        ...(await baseCipher.decryptStringAsync(value)),
        shouldReEncrypt: true,
      }),
      encryptStringAsync: async (value) => {
        encryptionCount += 1;
        return baseCipher.encryptStringAsync(value);
      },
    };

    assert.equal(await loadEncryptedSessionToken(tokenPath, rotatingCipher), "token");
    assert.equal(encryptionCount, 1);
  });
});
