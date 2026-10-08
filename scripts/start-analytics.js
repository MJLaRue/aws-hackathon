import "dotenv/config";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const python = process.env.ANALYTICS_PYTHON || `${root}.venv/bin/python`;
if (!existsSync(python)) {
  console.error(
    "Run npm run setup:analytics to install the Python analytics dependencies first.",
  );
  process.exit(1);
}
const child = spawn(python, ["app.py"], {
  cwd: `${root}backend`,
  env: { ...process.env, PYTHONUNBUFFERED: "1" },
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
