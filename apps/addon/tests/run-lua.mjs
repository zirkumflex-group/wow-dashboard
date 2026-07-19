import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const addonDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] ?? "test";

function findExecutable(candidates) {
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-v"], { encoding: "utf8" });
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }
  return null;
}

function run(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: addonDirectory,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (mode === "compile") {
  const compiler = findExecutable(["luac", "luac5.4", "luac.exe"]);
  if (!compiler) {
    throw new Error("A Lua compiler (luac 5.4) is required to validate the addon.");
  }
  run(compiler, ["-p", "wow-dashboard.lua"]);
  run(compiler, ["-p", "wow-dashboard-ui.lua"]);
  console.log("Lua syntax checks passed.");
} else if (mode === "test") {
  const interpreter = findExecutable(["lua", "lua5.4", "lua.exe"]);
  if (!interpreter) {
    throw new Error("A Lua 5.4 interpreter is required to test the addon.");
  }
  run(interpreter, ["tests/wow-dashboard.test.lua"]);
} else {
  throw new Error(`Unknown Lua runner mode: ${mode}`);
}
