import { spawn } from "node:child_process";

const subcommand = process.argv[2];

if (!subcommand) {
  throw new Error("Missing electron-vite subcommand.");
}

const npmExecPath = process.env.npm_execpath;

if (!npmExecPath) {
  throw new Error("npm_execpath is not set.");
}

const env = { ...process.env };

// Some shells export ELECTRON_RUN_AS_NODE globally, which makes Electron behave
// like plain Node and breaks `require(\"electron\")` in the main process.
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(process.execPath, [npmExecPath, "exec", "electron-vite", subcommand], {
  cwd: process.cwd(),
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
