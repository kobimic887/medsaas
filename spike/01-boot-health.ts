const port = Number(process.env.PORT || 3000);
const healthUrl = `http://127.0.0.1:${port}/health`;
const startupTimeoutMs = Number(process.env.STARTUP_TIMEOUT_MS || 30_000);

const env = {
  ...process.env,
  PORT: String(port),
  JWT_SECRET: process.env.JWT_SECRET || "bun_spike_jwt_secret_at_least_32_chars",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "bun_spike_unused_dummy_stripe_key",
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://localhost:27017/bun_spike_server",
  NODE_ENV: process.env.NODE_ENV || "test",
};

const child = Bun.spawn(["bun", "server/index.js"], {
  cwd: process.cwd(),
  env,
  stdout: "pipe",
  stderr: "pipe",
});

let serverLog = "";

async function collect(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) {
    return;
  }

  for await (const chunk of stream) {
    serverLog += new TextDecoder().decode(chunk);
  }
}

collect(child.stdout);
collect(child.stderr);

async function stopServer() {
  try {
    child.kill("SIGTERM");
    const result = await Promise.race([
      child.exited,
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 2_000)),
    ]);

    if (result === "timeout") {
      child.kill("SIGKILL");
      await child.exited;
    }
  } catch {
    // The process may already have exited.
  }
}

try {
  const deadline = Date.now() + startupTimeoutMs;
  let lastError = "";
  let healthy = false;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(healthUrl);
      if (response.status === 200) {
        const body = await response.json();
        if (body.status !== "OK") {
          throw new Error(`unexpected /health status field: ${JSON.stringify(body)}`);
        }

        console.log("PASS: Bun server /health returned 200");
        console.log(JSON.stringify(body));
        healthy = true;
        break;
      }

      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await Bun.sleep(250);
  }

  if (!healthy) {
    throw new Error(`server did not become healthy within ${startupTimeoutMs}ms; last error: ${lastError}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("Server output:");
  console.error(serverLog.trim());
  process.exitCode = 1;
} finally {
  await stopServer();
}
