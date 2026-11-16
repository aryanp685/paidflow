import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Seed contract: disposable owner has one active "Fixture Customer", one
// archived "Fixture Archived", and the other tenant owns FOREIGN_ID.
// Both IDs must be supplied by the local fixture, not production data.
const own = process.env.PAIDFLOW_CUSTOMER_BROWSER_OWN_ID;
const foreign = process.env.PAIDFLOW_CUSTOMER_BROWSER_FOREIGN_ID;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
if (!own || !foreign || !uuid.test(own) || !uuid.test(foreign) || own === foreign) throw new Error("Disposable fixture must provide distinct customer IDs.");
const ownId: string = own, foreignId: string = foreign;
const ownerEmail = "owner@customer.example.invalid", syntheticPassword = "local-only-synthetic-password";
async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(ownerEmail);
  await page.getByLabel("Password", { exact: true }).fill(syntheticPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/workspace/);
}
test.beforeEach(async ({ page }) => { await login(page); });

test("list search, archived filter and keyboard navigation", async ({ page }) => {
  await page.goto("/workspace/customers");
  await page.getByLabel("Search customer name").fill("Fixture Customer");
  await page.getByLabel("Search customer name").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Status", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("link", { name: "View Fixture Customer" })).toBeVisible();
  await page.getByLabel("Search customer name").fill("Fixture Archived");
  await page.getByLabel("Status", { exact: true }).selectOption("archived");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByRole("link", { name: "View Fixture Archived" })).toBeVisible();
});
test("creates a customer with synthetic details", async ({ page }) => {
  await page.goto("/workspace/customers/new");
  await page.getByRole("button", { name: /Start customer/ }).click();
  await page.getByLabel(/Customer name/).fill(`Browser ${randomUUID()}`);
  await page.getByLabel("Email address").fill(`${randomUUID()}@example.invalid`);
  await page.getByRole("button", { name: "Add customer" }).click();
  await expect(page.getByRole("status")).toContainText("Customer added");
});
test("edits and rejects a stale second tab", async ({ page, context }) => {
  const second = await context.newPage();
  await page.goto(`/workspace/customers/${ownId}/edit`);
  await second.goto(`/workspace/customers/${ownId}/edit`);
  await page.getByLabel(/Customer name/).fill("Fixture Customer First Edit");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Customer updated");
  await second.getByLabel(/Customer name/).fill("Fixture Customer Stale Edit");
  await second.getByRole("button", { name: "Save changes" }).click();
  await expect(second.getByRole("alert")).toContainText(/changed.*reload/i);
  await second.close();
});
test("detail displays history and denies another tenant", async ({ page }) => {
  await page.goto(`/workspace/customers/${ownId}`);
  for (const heading of ["Contact details", "Outstanding and aging", "Invoice history", "Payment history", "Customer activity"]) await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  await expect(page.getByRole("link", { name: "SYN-ITEM13-1" })).toBeVisible();
  await expect(page.getByText("₹25.00").first()).toBeVisible();
  await expect(page.getByText(/Customer created/)).toBeVisible();
  const response = await page.goto(`/workspace/customers/${foreignId}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Fixture Other Tenant")).toHaveCount(0);
  const editResponse = await page.goto(`/workspace/customers/${foreignId}/edit`);
  expect(editResponse?.status()).toBe(404);
});
test("customer list is usable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workspace/customers");
  await expect(page.getByRole("heading", { name: "Customers", exact: true })).toBeVisible();
  await expect(page.getByLabel("Search customer name")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
