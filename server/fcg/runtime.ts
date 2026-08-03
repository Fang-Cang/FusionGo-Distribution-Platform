import { FcgClient } from "./client.js";

export type FcgMode = "mock" | "sandbox" | "production";

function credential(prefix: "GLINK" | "FLINK") {
  const appKey = process.env[`FCG_${prefix}_APP_KEY`] || process.env.FCG_APP_KEY || "";
  const appSecret = process.env[`FCG_${prefix}_APP_SECRET`] || process.env.FCG_APP_SECRET || "";
  return { appKey, appSecret };
}

export function getFcgRuntime() {
  const rawMode = process.env.FCG_MODE || "mock";
  const mode: FcgMode = rawMode === "sandbox" || rawMode === "production" ? rawMode : "mock";
  const baseUrl = (process.env.FCG_BASE_URL || "https://open.fusionconnectgroup.com").replace(/\/$/, "");
  const glinkCredentials = credential("GLINK");
  const flinkCredentials = credential("FLINK");
  return {
    mode,
    environment: process.env.FCG_ENV || mode,
    baseUrl,
    glinkConfigured: Boolean(glinkCredentials.appKey && glinkCredentials.appSecret),
    flinkConfigured: Boolean(flinkCredentials.appKey && flinkCredentials.appSecret),
    glinkCredentials,
    glink: new FcgClient(baseUrl, glinkCredentials),
    flink: new FcgClient(baseUrl, flinkCredentials),
  };
}
