import { db, migrate, definitions } from "./db.js";
import { seed } from "./seed.js";
import { rolloverDueYears } from "./rollover.js";
try {
  const command = process.argv[2];
  if (["migrate", "setup"].includes(command)) {
    await migrate();
    console.log(
      `Migrated ${Object.keys(definitions).length} application tables / ${Object.values(definitions).reduce((n, d) => n + Object.keys(d.attributes).length, 0)} columns, plus SequelizeMeta.`,
    );
  }
  if (["seed", "setup"].includes(command)) await seed();
  if (command === "rollover") await rolloverDueYears();
  if (!["migrate", "seed", "setup", "rollover"].includes(command))
    throw new Error("Use migrate, seed, setup, or rollover.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await db.close();
}
