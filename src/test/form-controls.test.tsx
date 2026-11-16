import fs from "node:fs";
import path from "node:path";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormSelect } from "@/components/ui/form-select";
import { DateField } from "@/components/ui/date-field";

/**
 * Redesign phase 2: the design-system replacements for native form controls keep the native
 * contract (`{ target: { value } }`, `""` allowed, YYYY-MM-DD days), so migrated screens behave
 * exactly as before — and no native control comes back.
 */
afterEach(cleanup);

const open = (name: string) =>
  fireEvent.keyDown(screen.getByRole("combobox", { name }), { key: "Enter" });

describe("FormSelect", () => {
  it("shows the chosen option and reports changes with the native event shape", async () => {
    const onChange = vi.fn();
    render(
      <FormSelect aria-label="Status" value="paid" onChange={onChange}>
        <option value="pending">Pending</option>
        <option value="paid">Paid</option>
      </FormSelect>,
    );
    expect(screen.getByRole("combobox", { name: "Status" })).toHaveTextContent("Paid");
    open("Status");
    fireEvent.click(await screen.findByRole("option", { name: "Pending" }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: "pending" } });
  });

  it("supports the empty value (e.g. 'All') that Radix reserves", async () => {
    function Harness() {
      const [v, setV] = useState("x");
      return (
        <>
          <FormSelect aria-label="Store" value={v} onChange={(e) => setV(e.target.value)}>
            <option value="">All stores</option>
            <option value="x">Downtown</option>
          </FormSelect>
          <output data-testid="v">{JSON.stringify(v)}</output>
        </>
      );
    }
    render(<Harness />);
    open("Store");
    fireEvent.click(await screen.findByRole("option", { name: "All stores" }));
    expect(screen.getByTestId("v")).toHaveTextContent('""');
    expect(screen.getByRole("combobox", { name: "Store" })).toHaveTextContent("All stores");
  });

  it("a disabled empty option is the prompt (placeholder), not a choice", async () => {
    render(
      <FormSelect aria-label="Category" value="" onChange={() => {}}>
        <option value="" disabled>
          Select category…
        </option>
        <option value="sides">Sides</option>
      </FormSelect>,
    );
    expect(screen.getByRole("combobox", { name: "Category" })).toHaveTextContent(
      "Select category…",
    );
    open("Category");
    expect(await screen.findAllByRole("option")).toHaveLength(1);
  });

  it("keeps only layout classes from a call site (the look comes from the design system)", () => {
    render(
      <FormSelect
        aria-label="Plan"
        value="a"
        onChange={() => {}}
        className="h-9 rounded-md border bg-background px-3 text-sm lg:w-56 w-full mt-1"
      >
        <option value="a">A</option>
      </FormSelect>,
    );
    const cls = screen.getByRole("combobox", { name: "Plan" }).className;
    expect(cls).toContain("lg:w-56");
    expect(cls).toContain("w-full");
    expect(cls).toContain("mt-1");
    expect(cls).not.toContain("bg-background");
    expect(cls).toContain("border-input");
  });
});

describe("DateField", () => {
  it("shows the day and emits YYYY-MM-DD without shifting across time zones", async () => {
    const onChange = vi.fn();
    render(<DateField id="due" value="2026-11-16" onChange={onChange} />);
    const trigger = document.getElementById("due")!;
    expect(trigger).toHaveTextContent("Nov 16, 2026");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: /November 20th, 2026/ }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: "2026-11-20" } });
  });

  it("an empty value shows the placeholder", () => {
    render(<DateField id="d" value="" placeholder="Pick a day" onChange={() => {}} />);
    expect(document.getElementById("d")).toHaveTextContent("Pick a day");
  });
});

describe("policy: no native select or date input in the app", () => {
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
  it.each(["<select", 'type="date"', 'type="month"', 'type="datetime-local"'])("%s", (needle) => {
    const offenders = files.filter((f) => fs.readFileSync(f, "utf8").includes(needle));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
});

describe("FormSelect width", () => {
  it("takes its content's width when the call site sets none (like the native select)", () => {
    render(
      <FormSelect aria-label="Channel" value="a" onChange={() => {}} className="h-9 rounded-md">
        <option value="a">All channels</option>
      </FormSelect>,
    );
    expect(screen.getByRole("combobox", { name: "Channel" }).className).toContain("w-auto");
  });
});
