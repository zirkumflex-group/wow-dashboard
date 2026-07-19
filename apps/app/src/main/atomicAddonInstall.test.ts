import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { replaceDirectoryAtomically } from "./atomicAddonInstall";

const temporaryRoots: string[] = [];

async function createFixture() {
  const rootDirectory = await mkdtemp(join(tmpdir(), "wow-dashboard-atomic-install-"));
  temporaryRoots.push(rootDirectory);
  return {
    rootDirectory,
    targetDirectory: join(rootDirectory, "wow-dashboard"),
    stagedDirectory: join(rootDirectory, ".wow-dashboard-install-test"),
    backupDirectory: join(rootDirectory, ".wow-dashboard-backup-test"),
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("atomic addon directory replacement", () => {
  it("replaces an existing addon and removes its backup", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.targetDirectory);
    await writeFile(join(fixture.targetDirectory, "version.txt"), "old");
    await mkdir(fixture.stagedDirectory);
    await writeFile(join(fixture.stagedDirectory, "version.txt"), "new");

    await replaceDirectoryAtomically(fixture);

    assert.equal(await readFile(join(fixture.targetDirectory, "version.txt"), "utf8"), "new");
    assert.deepEqual(await readdir(fixture.rootDirectory), ["wow-dashboard"]);
  });

  it("installs a staged addon when no prior addon exists", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.stagedDirectory);
    await writeFile(join(fixture.stagedDirectory, "version.txt"), "first");

    await replaceDirectoryAtomically(fixture);

    assert.equal(await readFile(join(fixture.targetDirectory, "version.txt"), "utf8"), "first");
  });

  it("restores the prior addon when activating the staged directory fails", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.targetDirectory);
    await writeFile(join(fixture.targetDirectory, "version.txt"), "old");

    await assert.rejects(replaceDirectoryAtomically(fixture), { code: "ENOENT" });

    assert.equal(await readFile(join(fixture.targetDirectory, "version.txt"), "utf8"), "old");
    assert.deepEqual(await readdir(fixture.rootDirectory), ["wow-dashboard"]);
  });

  it("rejects any target outside the approved root before moving data", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.stagedDirectory);

    await assert.rejects(
      replaceDirectoryAtomically({
        ...fixture,
        targetDirectory: resolve(fixture.rootDirectory, "..", "outside-addon"),
      }),
      /outside the approved root/,
    );

    assert.deepEqual(await readdir(fixture.rootDirectory), [".wow-dashboard-install-test"]);
  });
});
