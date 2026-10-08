import { Op } from "sequelize";
import { db, models as M } from "./db.js";
import { createApp } from "./app.js";
import { rolloverDueYears } from "./rollover.js";
await db.authenticate();
// Startup checks and minute checks catch July 1 in America/Chicago and restarts after that date.
async function maintenance() {
  await rolloverDueYears();
  await M.sessions.destroy({ where: { expires_at: { [Op.lt]: new Date() } } });
  await M.saml_requests.destroy({
    where: { expires_at: { [Op.lt]: new Date() } },
  });
  await M.import_previews.update(
    { status: "expired" },
    { where: { status: "pending", expires_at: { [Op.lt]: new Date() } } },
  );
}
await maintenance();
let running = false;
const timer = setInterval(async () => {
  if (running) return;
  running = true;
  try {
    await maintenance();
  } catch (error) {
    console.error("Maintenance failed:", error.message);
  } finally {
    running = false;
  }
}, 60 * 1000).unref();
const server = createApp().listen(
  Number(process.env.PORT || 3001),
  process.env.HOST || "127.0.0.1",
  () =>
    console.log(
      `Budget API listening on http://${process.env.HOST || "127.0.0.1"}:${process.env.PORT || 3001}`,
    ),
);
async function shutdown() {
  clearInterval(timer);
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
