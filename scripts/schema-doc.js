import { mkdir, writeFile } from "node:fs/promises";
import { DataTypes as D } from "sequelize";
import { db, definitions } from "../server/db.js";
const count = Object.values(definitions).reduce(
  (n, d) => n + Object.keys(d.attributes).length,
  0,
);
let text = `# MySQL schema inventory\n\nGenerated from server/db.js. ${Object.keys(definitions).length} application tables, ${count} columns, plus SequelizeMeta(name VARCHAR(255) PRIMARY KEY). All timestamps are stored in UTC; fiscal-year boundaries use America/Chicago. Canonical schema changes use recorded migrations; database/schema.sql is a reference export of the initialized MySQL database.\n\n`;
for (const [table, definition] of Object.entries(definitions)) {
  text += `## ${table}\n\n| Column | MySQL type | Null | Default | Keys and references |\n| --- | --- | --- | --- | --- |\n`;
  for (const [column, attr] of Object.entries(definition.attributes)) {
    const type =
      attr.type?.toSql?.({ escape: (value) => db.escape(value) }) ||
      String(attr.type);
    const keys = [
      attr.primaryKey ? "PK" : "",
      attr.unique ? "UQ" : "",
      attr.autoIncrement ? "auto increment" : "",
      attr.references
        ? `FK → ${attr.references.model}.${attr.references.key}; delete ${attr.onDelete}`
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    const defaultValue =
      attr.defaultValue === D.NOW || attr.defaultValue instanceof D.NOW
        ? "CURRENT_TIMESTAMP"
        : attr.defaultValue === undefined
          ? "—"
          : String(attr.defaultValue);
    text += `| ${column} | ${type} | ${attr.allowNull ? "yes" : "no"} | ${defaultValue} | ${keys || "—"} |\n`;
  }
  if (definition.indexes.length)
    text +=
      "\n" +
      definition.indexes
        .map(
          (x) =>
            `- ${x.unique ? "Unique key" : "Index"}: ${x.fields.join(" + ")}`,
        )
        .join("\n") +
      "\n";
  text += "\n";
}
await mkdir("docs", { recursive: true });
await writeFile("docs/SCHEMA.md", text);
await db.close();
console.log(`Documented ${count} application columns.`);
