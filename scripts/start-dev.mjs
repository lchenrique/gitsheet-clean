import net from "node:net";
import { spawn } from "node:child_process";
import readline from "node:readline";

const port = Number(process.env.PORT || 3000);
const host = "127.0.0.1";
const shouldStartWorker = process.env.DEV_AUTOSTART_SYNC_WORKER !== "false";

function isPortBusy(targetPort, targetHost) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") {
        resolve(false);
        return;
      }

      reject(error);
    });

    socket.setTimeout(1000);
    socket.connect(targetPort, targetHost);
  });
}

const busy = await isPortBusy(port, host);

if (busy) {
  console.error(
    [
      `A porta ${port} ja esta em uso.`,
      "Pare a instancia atual do Next antes de rodar outro `npm run dev` neste projeto.",
      "Isso evita 404 em `/_next/static/*` e a perda aparente de CSS durante a navegacao.",
    ].join("\n"),
  );
  process.exit(1);
}

const nextBin = process.platform === "win32" ? "node_modules/next/dist/bin/next" : "./node_modules/next/dist/bin/next";
const tsxBin = process.platform === "win32" ? "./node_modules/tsx/dist/cli.mjs" : "./node_modules/tsx/dist/cli.mjs";

const child = spawn(process.execPath, [nextBin, "dev", "--port", String(port)], {
  stdio: ["inherit", "pipe", "pipe"],
  env: process.env,
});

const worker = shouldStartWorker
  ? spawn(process.execPath, [tsxBin, "scripts/daily-sync-worker.ts"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    })
  : null;

const readyPattern = /Ready in|ready started server|Local:/i;
let warmedUp = false;

async function warmupRoutes() {
  if (warmedUp) {
    return;
  }

  warmedUp = true;

  const routes = ["/login", "/repos", "/config", "/sheet"];
  const baseUrl = `http://${host}:${port}`;

  for (const route of routes) {
    try {
      await fetch(`${baseUrl}${route}`, {
        headers: {
          "x-gitsheet-dev-warmup": "1",
        },
      });
      console.log(`[warmup] ${route}`);
    } catch (error) {
      console.warn(`[warmup] falhou em ${route}: ${error instanceof Error ? error.message : "erro desconhecido"}`);
    }
  }
}

const stdout = readline.createInterface({ input: child.stdout });
stdout.on("line", (line) => {
  console.log(line);

  if (readyPattern.test(line)) {
    void warmupRoutes();
  }
});

const stderr = readline.createInterface({ input: child.stderr });
stderr.on("line", (line) => {
  console.error(line);
});

if (worker?.stdout) {
  const workerStdout = readline.createInterface({ input: worker.stdout });
  workerStdout.on("line", (line) => {
    console.log(`[worker] ${line}`);
  });
}

if (worker?.stderr) {
  const workerStderr = readline.createInterface({ input: worker.stderr });
  workerStderr.on("line", (line) => {
    console.error(`[worker] ${line}`);
  });
}

function shutdownChildren(signal = "SIGTERM") {
  if (worker && !worker.killed) {
    worker.kill(signal);
  }

  if (!child.killed) {
    child.kill(signal);
  }
}

process.on("SIGINT", () => shutdownChildren("SIGINT"));
process.on("SIGTERM", () => shutdownChildren("SIGTERM"));

child.on("exit", (code, signal) => {
  if (worker && !worker.killed) {
    worker.kill("SIGTERM");
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
