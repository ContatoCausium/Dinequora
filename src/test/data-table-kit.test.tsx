import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, act, screen } from "@testing-library/react";
import "@/lib/i18n";
import { Pager, SortableTh } from "@/components/app/data-table";
import { useSort } from "@/lib/use-sort";
import { OrderStatusBadge } from "@/components/app/status-badge";
import { ORDER_STATUS_STYLE } from "@/components/app/status-styles";

/**
 * Redesign phase 3: the table kit is presentation only (it reorders/pages rows already on screen)
 * and every data table in the app shares the same treatment.
 */
afterEach(cleanup);

type Row = { id: number; name: string; total: number | null };
const ROWS: Row[] = [
  { id: 1, name: "Brioche bun", total: 30 },
  { id: 2, name: "apple pie", total: null },
  { id: 3, name: "Cheeseburger", total: 30 },
  { id: 4, name: "Bacon", total: 12 },
];

describe("useSort", () => {
  const accessors = { name: (r: Row) => r.name, total: (r: Row) => r.total };
  it("cycles ascending → descending → original order", () => {
    const { result } = renderHook(() => useSort(ROWS, accessors));
    expect(result.current.sorted.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    act(() => result.current.toggle("name"));
    expect(result.current.sorted.map((r) => r.name)).toEqual([
      "apple pie",
      "Bacon",
      "Brioche bun",
      "Cheeseburger",
    ]); // case-insensitive
    act(() => result.current.toggle("name"));
    expect(result.current.sort).toEqual({ key: "name", dir: "desc" });
    act(() => result.current.toggle("name"));
    expect(result.current.sort).toBeNull();
    expect(result.current.sorted.map((r) => r.id)).toEqual([1, 2, 3, 4]);
  });
  it("is stable on ties and puts empty values last in both directions", () => {
    const { result } = renderHook(() => useSort(ROWS, accessors));
    act(() => result.current.toggle("total"));
    expect(result.current.sorted.map((r) => r.id)).toEqual([4, 1, 3, 2]);
    act(() => result.current.toggle("total"));
    expect(result.current.sorted.map((r) => r.id)).toEqual([1, 3, 4, 2]);
  });
  it("never adds or drops rows", () => {
    const { result } = renderHook(() => useSort(ROWS, accessors));
    act(() => result.current.toggle("total"));
    expect(result.current.sorted).toHaveLength(ROWS.length);
  });
});

describe("SortableTh", () => {
  it("exposes the sort state to assistive technology", () => {
    const onSort = vi.fn();
    render(
      <table>
        <thead>
          <tr>
            <SortableTh
              label="Total"
              sortKey="total"
              sort={{ key: "total", dir: "desc" }}
              onSort={onSort}
            />
            <SortableTh
              label="Name"
              sortKey="name"
              sort={{ key: "total", dir: "desc" }}
              onSort={onSort}
            />
          </tr>
        </thead>
      </table>,
    );
    expect(screen.getByRole("columnheader", { name: /Total/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute("aria-sort", "none");
    fireEvent.click(screen.getByRole("button", { name: /Name/ }));
    expect(onSort).toHaveBeenCalledWith("name");
  });
});

describe("Pager", () => {
  it("shows the range and disables the edges", () => {
    const onPage = vi.fn();
    render(<Pager page={1} pageCount={8} pageSize={20} total={151} onPage={onPage} />);
    expect(screen.getByText("1–20 of 151")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
  it("renders nothing for a single page", () => {
    const { container } = render(
      <Pager page={1} pageCount={1} pageSize={20} total={5} onPage={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("order statuses", () => {
  it("every status has a tone and an icon, and the label is always shown", () => {
    for (const s of ["new", "confirmed", "in_prep", "ready", "delivered", "cancelled"]) {
      expect(ORDER_STATUS_STYLE[s], s).toBeDefined();
      cleanup();
      render(<OrderStatusBadge status={s} label={`L-${s}`} />);
      const badge = screen.getByText(`L-${s}`);
      expect(badge.querySelector("svg")).not.toBeNull();
    }
    expect(ORDER_STATUS_STYLE["delivered"]!.tone).toBe("success");
    expect(ORDER_STATUS_STYLE["cancelled"]!.tone).toBe("danger");
  });
});

describe("policy: every data table uses the shared treatment", () => {
  const root = path.resolve(__dirname, "..");
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!["test", "ui"].includes(e.name)) walk(p);
      } else if (p.endsWith(".tsx")) files.push(p);
    }
  };
  walk(path.join(root, "routes"));
  walk(path.join(root, "components"));
  it("no <table> outside the kit (except accessible chart tables and the permission grid)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith("permission-matrix.tsx")) continue;
      for (const m of fs.readFileSync(f, "utf8").matchAll(/<table className="([^"]*)"/g))
        if (!/\b(data-table|sr-only)\b/.test(m[1]!)) offenders.push(path.relative(root, f));
    }
    expect(offenders).toEqual([]);
  });
});
