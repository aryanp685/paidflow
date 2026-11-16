import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { cleanup } from "@testing-library/react";

const { getWorkspace } = vi.hoisted(() => ({ getWorkspace: vi.fn() }));
vi.mock("@/lib/supabase/guard", () => ({ getWorkspace }));
import WorkspacePage from "@/app/(workspace)/workspace/page";

function setup(results: Record<string, { count: number | null; error: object | null }>) {
  const filters: Record<string, [string, unknown][]> = {};
  const from = vi.fn((table: string) => {
    filters[table] = [];
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => { filters[table].push([column, value]); return query; }),
      then: (resolve: (value: unknown) => void) => Promise.resolve(results[table]).then(resolve),
    };
    return query;
  });
  getWorkspace.mockResolvedValue({ business: { id: "business-a", name: "Example" }, supabase: { from } });
  return { from, filters };
}
beforeEach(() => { vi.clearAllMocks(); cleanup(); });
describe("workspace overview", () => {
  it("displays real scoped counts with correct recorded and issued filters", async () => {
    const { filters } = setup({ customers: { count: 2, error: null }, invoices: { count: 4, error: null }, payments: { count: 7, error: null } });
    render(await WorkspacePage());
    expect(screen.getByText("2")).toBeTruthy(); expect(screen.getByText("4")).toBeTruthy(); expect(screen.getByText("7")).toBeTruthy();
    for (const table of ["customers", "invoices", "payments"]) expect(filters[table]).toContainEqual(["business_id", "business-a"]);
    expect(filters.customers).toContainEqual(["is_archived", false]);
    expect(filters.invoices).toContainEqual(["lifecycle_status", "issued"]);
    expect(filters.payments).toContainEqual(["status", "recorded"]);
  });
  it("fails rather than reporting zero when a database query fails or lacks a count", async () => {
    setup({ customers: { count: null, error: { message: "offline" } }, invoices: { count: 0, error: null }, payments: { count: 0, error: null } });
    await expect(WorkspacePage()).rejects.toThrow("Unable to load workspace overview");
  });
  it("rejects malformed counts from any result instead of displaying misleading metrics", async () => {
    for (const table of ["customers", "invoices", "payments"]) {
      for (const count of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2", true, null, undefined]) {
        const results = { customers: { count: 0, error: null }, invoices: { count: 0, error: null }, payments: { count: 0, error: null } };
        results[table as keyof typeof results].count = count as number;
        setup(results);
        await expect(WorkspacePage()).rejects.toThrow("Unable to load workspace overview");
      }
    }
  });
  it("explains the separate-query snapshot limitation", async () => {
    setup({ customers: { count: 0, error: null }, invoices: { count: 0, error: null }, payments: { count: 0, error: null } });
    render(await WorkspacePage());
    expect(screen.getByText(/Counts are loaded separately/)).toBeTruthy();
  });
});
