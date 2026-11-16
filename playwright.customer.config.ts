import { defineConfig, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
// These destructive synthetic-fixture tests must run only with all services in
// the SAME disposable network namespace, without any route to a real provider.
const ip = (family: string) => execFileSync("ip", [family, "route", "show"], { encoding: "utf8" }).trim();
if (ip("-4") || ip("-6")) throw new Error("Customer browser tests require a disposable no-egress network namespace.");
const baseURL = process.env.PAIDFLOW_CUSTOMER_BROWSER_URL;
if (!baseURL) throw new Error("Start the disposable local app/provider fixture first; PAIDFLOW_CUSTOMER_BROWSER_URL is required.");
const url = new URL(baseURL);
if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Customer browser fixture must use a loopback HTTP origin.");
export default defineConfig({ testDir: "./tests/customer-browser", workers: 1, use: { baseURL: url.origin, ...devices["Desktop Chrome"] } });
