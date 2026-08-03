import "dotenv/config";
import { databasePath, FusionDatabase } from "../server/database.js";

const database = new FusionDatabase(databasePath());
const status = database.status();
database.close();

console.log(JSON.stringify({
  ok: true,
  action: "migrate",
  database: status.database,
  migrationVersion: status.migrationVersion,
}, null, 2));
