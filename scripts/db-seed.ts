import "dotenv/config";
import { databasePath, FusionDatabase } from "../server/database.js";

const database = new FusionDatabase(databasePath());
if (process.argv.includes("--reset")) database.resetAndSeed();
else database.seed();
const status = database.status();
database.close();

console.log(JSON.stringify({
  ok: true,
  action: process.argv.includes("--reset") ? "reset-and-seed" : "seed",
  ...status,
}, null, 2));
