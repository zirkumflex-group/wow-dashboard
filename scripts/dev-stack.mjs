import { existsSync } from "node:fs";
import net from "node:net";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { config as loadDotenv } from "dotenv";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dockerCommand = process.platform === "win32" ? "docker.exe" : "docker";
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const composeArgs = ["compose", "-f", "deploy/docker-compose.dev.yml"];
const trackedServices = [
  { service: "postgres", container: "wow-dashboard-postgres-dev" },
  { service: "redis", container: "wow-dashboard-redis-dev" },
];

let shuttingDown = false;
const serviceProcesses = [];
const servicesStartedByScript = new Set();

loadRootEnv();

const apiPort = resolvePort(["PORT"], ["BETTER_AUTH_URL", "API_URL", "VITE_API_URL"], 3000);
const webPort = resolvePort([], ["SITE_URL", "VITE_SITE_URL"], 3001);

process.on("SIGINT", () => {
  void shutdown(130);
});

process.on("SIGTERM", () => {
  void shutdown(143);
});

process.on("uncaughtException", (error) => {
  console.error("[dev]", error);
  void shutdown(1);
});

process.on("unhandledRejection", (error) => {
  console.error("[dev]", error);
  void shutdown(1);
});

try {
  await ensurePortFree(
    apiPort,
    `API port ${apiPort} is already in use. Stop the existing process or override PORT/API_URL/BETTER_AUTH_URL/VITE_API_URL before running pnpm dev.`,
  );
  await ensurePortFree(
    webPort,
    `Web port ${webPort} is already in use. Stop the existing process or override SITE_URL/VITE_SITE_URL before running pnpm dev.`,
  );

  for (const { service, container } of trackedServices) {
    if (!(await isContainerRunning(container))) {
      servicesStartedByScript.add(service);
    }
  }

  console.log("[dev] starting local Postgres and Redis");
  await runChecked(dockerCommand, [...composeArgs, "up", "-d", "postgres", "redis"]);

  console.log("[dev] waiting for local infrastructure");
  for (const { container } of trackedServices) {
    await waitForHealthyContainer(container);
  }

  console.log("[dev] applying database migrations");
  await runChecked(pnpmCommand, ["-F", "@wow-dashboard/db", "migrate"]);

  console.log("[dev] starting API, worker, web, and Electron");
  startService("@wow-dashboard/api", ["-F", "@wow-dashboard/api", "dev"], process.env);
  startService("@wow-dashboard/worker", ["-F", "@wow-dashboard/worker", "dev"], process.env);
  startService("web", ["-F", "web", "dev"], withoutPortEnv(process.env));
  startService("app", ["-F", "app", "dev"], withoutPortEnv(process.env));
} catch (error) {
  console.error("[dev]", error instanceof Error ? error.message : error);
  await shutdown(1);
}

function loadRootEnv() {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const envFiles = [
    `.env.${nodeEnv}.local`,
    ".env.local",
    `.env.${nodeEnv}`,
    ".env",
  ].map((fileName) => resolve(repoRoot, fileName));

  for (const path of envFiles) {
    if (!existsSync(path)) continue;
    loadDotenv({ path, override: false });
  }
}

function resolvePort(directEnvKeys, urlEnvKeys, fallbackPort) {
  for (const key of directEnvKeys) {
    const value = process.env[key];
    if (!value) continue;
    const parsedPort = Number.parseInt(value, 10);
    if (!Number.isNaN(parsedPort) && parsedPort > 0) {
      return parsedPort;
    }
  }

  for (const key of urlEnvKeys) {
    const value = process.env[key];
    if (!value) continue;

    try {
      const url = new URL(value);
      if (url.port) {
        return Number.parseInt(url.port, 10);
      }

      return url.protocol === "https:" ? 443 : 80;
    } catch {
      // Ignore malformed values here; the app-specific env validation will report them later.
    }
  }

  return fallbackPort;
}

function ensurePortFree(port, message) {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = net.createServer();

    server.once("error", (error) => {
      if (error && typeof error === "object" && "code" in error && error.code === "EADDRINUSE") {
        rejectPromise(new Error(message));
        return;
      }

      rejectPromise(error);
    });

    server.once("listening", () => {
      server.close((error) => {
        if (error) {
          rejectPromise(error);
          return;
        }

        resolvePromise();
      });
    });

    server.listen(port, "127.0.0.1");
  });
}

async function isContainerRunning(containerName) {
  const { code, stdout } = await runCaptured(
    dockerCommand,
    ["inspect", "--format", "{{.State.Running}}", containerName],
    { allowFailure: true },
  );

  return code === 0 && stdout.trim() === "true";
}

async function waitForHealthyContainer(containerName) {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const { code, stdout } = await runCaptured(
      dockerCommand,
      [
        "inspect",
        "--format",
        "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
        containerName,
      ],
      { allowFailure: true },
    );

    const status = stdout.trim();

    if (code === 0 && (status === "healthy" || status === "running")) {
      return;
    }

    if (code === 0 && status === "exited") {
      throw new Error(`${containerName} exited before it became ready.`);
    }

    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for ${containerName} to become ready.`);
}

function runChecked(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(
        new Error(
          signal
            ? `${command} ${args.join(" ")} terminated with signal ${signal}.`
            : `${command} ${args.join(" ")} exited with code ${code}.`,
        ),
      );
    });
  });
}

function runCaptured(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (!options.allowFailure && code !== 0) {
        rejectPromise(new Error(stderr.trim() || `${command} ${args.join(" ")} exited with code ${code}.`));
        return;
      }

      resolvePromise({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function startService(name, args, env) {
  const child = spawn(pnpmCommand, args, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });

  serviceProcesses.push({ name, child });

  child.on("error", (error) => {
    if (shuttingDown) return;
    console.error(`[dev] ${name} failed to start:`, error);
    void shutdown(1);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;

    const exitReason = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    console.error(`[dev] ${name} exited with ${exitReason}`);
    void shutdown(code ?? 1);
  });
}

function withoutPortEnv(sourceEnv) {
  const env = { ...sourceEnv };
  delete env.PORT;
  return env;
}

async function shutdown(exitCode) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const { child } of serviceProcesses) {
    if (child.exitCode !== null || child.signalCode !== null) {
      continue;
    }

    child.kill("SIGINT");
  }

  if (serviceProcesses.length > 0) {
    await Promise.all(serviceProcesses.map(({ child }) => onceExit(child)));
  }

  if (servicesStartedByScript.size > 0) {
    const services = [...servicesStartedByScript];

    try {
      console.log(`[dev] stopping local ${services.join(" + ")}`);
      await runChecked(dockerCommand, [...composeArgs, "stop", ...services]);
    } catch (error) {
      console.error("[dev]", error instanceof Error ? error.message : error);
    }
  }

  process.exit(exitCode);
}

function onceExit(child) {
  return new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolvePromise();
      return;
    }

    child.once("exit", () => {
      resolvePromise();
    });
  });
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
