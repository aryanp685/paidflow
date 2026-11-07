import { test, expect } from "@playwright/test";
for (const width of [360, 390, 768, 1024, 1440, 1920]) {
  test(`landing page at ${width}px has no horizontal overflow or browser errors`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /stop chasing payments/i })).toBeVisible();
    await expect(page.getByText("ILLUSTRATIVE PREVIEW")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    expect(errors).toEqual([]);
    const broken = await page.locator('a[href^="#"]').evaluateAll(links => links.map(a => a.getAttribute("href")!).filter(href => href.length > 1 && !document.getElementById(href.slice(1))));
    expect(broken).toEqual([]);
    if (width < 900) { await page.getByRole("button", { name: "Open navigation menu" }).click(); await expect(page.getByRole("dialog")).toBeVisible(); await page.getByRole("dialog").getByRole("link", { name: /features/i }).click(); await expect(page.getByRole("dialog")).not.toBeVisible(); }
  });
}
test("preview controls, FAQ, and reduced motion work", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "90 days" }).click(); await expect(page.getByRole("button", { name: "90 days" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /automatically verify UPI/i }).click(); await expect(page.getByText(/not automatically verified/i)).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
});
