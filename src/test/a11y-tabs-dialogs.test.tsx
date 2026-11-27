import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18n from "@/lib/i18n";
import { DateField } from "@/components/ui/date-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The five accessibility findings of the Phase 7 preflight (axe-core, WCAG A/AA) in tabs, dialogs and
 * menus, each pinned so it cannot come back:
 *   scrollable-region-focusable  Inventory › Movements, Team › Activity, member access matrix,
 *                                Finance › Store comparison
 *   aria-allowed-attr            aria-required on the DateField button (New expense)
 *   aria-hidden-focus            the page marked aria-hidden while the account menu is open
 */
beforeAll(async () => {
  await i18n.changeLanguage("en-US");
});
afterEach(cleanup);

describe("DateField: required without aria-required on a button", () => {
  it("says it is required in its description, keeping the form's own hint", () => {
    render(
      <>
        <p id="hint">Defaults to the due date.</p>
        <DateField id="d" value="" onChange={() => {}} aria-describedby="hint" required />
      </>,
    );
    const button = document.getElementById("d")!;
    expect(button.tagName).toBe("BUTTON");
    expect(button).not.toHaveAttribute("aria-required");
    const ids = (button.getAttribute("aria-describedby") ?? "").split(" ");
    expect(ids[0]).toBe("hint");
    expect(ids).toHaveLength(2);
    expect(document.getElementById(ids[1]!)).toHaveTextContent("Required");
    expect(button).toHaveAccessibleDescription("Defaults to the due date. Required");
  });

  it("an optional field has no extra description", () => {
    render(<DateField id="d" value="" onChange={() => {}} />);
    const button = document.getElementById("d")!;
    expect(button).not.toHaveAttribute("aria-required");
    expect(button).not.toHaveAttribute("aria-describedby");
  });
});

describe("DropdownMenu: the page stays exposed while a menu is open", () => {
  it("does not mark the rest of the page aria-hidden, and still closes on Escape", async () => {
    render(
      <>
        <a href="#main">Skip to content</a>
        <aside>
          <button type="button">Sidebar link</button>
        </aside>
        <DropdownMenu>
          <DropdownMenuTrigger>Account</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Sign out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Account" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    const item = await screen.findByRole("menuitem", { name: "Sign out" });
    expect(item).toBeVisible();
    expect(
      document.querySelectorAll("[aria-hidden='true'], [data-aria-hidden='true']"),
    ).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Skip to content" })).toBeInTheDocument();
    fireEvent.keyDown(item, { key: "Escape" });
    expect(screen.queryByRole("menuitem", { name: "Sign out" })).toBeNull();
  });
});

describe("scrollable tables are reachable by keyboard and named", () => {
  const root = path.resolve(__dirname, "..");
  const cases: Array<[string, string, string]> = [
    [
      "components/pages/inventory-page.tsx",
      "max-h-[640px] overflow-auto",
      'aria-label={t("movements.title")}',
    ],
    [
      "components/team/activity-tab.tsx",
      "max-h-[640px] overflow-auto",
      'aria-label={t("tabs.activity")}',
    ],
    [
      "components/team/permission-matrix.tsx",
      "overflow-x-auto rounded-lg border",
      "aria-label={caption}",
    ],
    [
      "components/finance/finance-sections.tsx",
      "mt-5 overflow-x-auto rounded-md border",
      'aria-label={t("stores.title")}',
    ],
  ];
  it.each(cases)("%s", (file, scrollClass, label) => {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    const at = src.indexOf(scrollClass);
    expect(at, `scroll container "${scrollClass}"`).toBeGreaterThan(-1);
    // The opening tag of the scroll container: from its "<div" to the class.
    const open = src.slice(src.lastIndexOf("<div", at), at);
    expect(open).toContain('role="region"');
    expect(open).toContain("tabIndex={0}");
    expect(open).toContain(label);
  });
});

describe("DateField: the required note follows the language", () => {
  it("reads Obrigatório in Portuguese", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      render(<DateField id="d" value="" onChange={() => {}} required />);
      expect(document.getElementById("d")).toHaveAccessibleDescription("Obrigatório");
    } finally {
      await i18n.changeLanguage("en-US");
    }
  });
});
