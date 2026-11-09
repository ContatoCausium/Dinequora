---
name: servora-premium-design
description: Servora's permanent UI/UX rules. Use before creating or changing any screen, component, chart, copy or image in this repo (src/routes, src/components, src/locales) — e.g. "improve the POS", "new page", "fix this card", "add product photos", "translate the KDS". Covers tokens, components, layout, states, i18n, formatting, data honesty, accessibility and how to verify in the browser.
---

# Servora premium design

Servora is a white-label operations SaaS for multi-store restaurant groups. "Premium" here means
**calm, dense-but-legible, and trustworthy**: the owner should find the number that needs action in
under 3 seconds, and every number must be real. Decoration never beats clarity.

Read `AGENTS.md` first — its architecture rules (white-label, theme engine, i18n, demo labelling,
"Coming next" items, store scoping) override anything here.

## 1. Tokens — the only colors allowed

- Use semantic tokens only: `background, foreground, card, muted(-foreground), primary(-soft/-foreground),
  accent, border, input, ring, success, warning, destructive, chart-1..6, sidebar-*`.
  They are generated per tenant by `generateTheme()` (`src/lib/theme-engine.ts`) with contrast checks.
- **Never** raw palette classes (`bg-emerald-600`, `text-red-500`, `from-blue-…`) or hex in components.
  A tenant with a red brand must still read correctly. Grep for drift:
  `rg -n "\b(bg|text|border|ring|from|to)-(red|green|emerald|amber|yellow|orange|blue|sky|indigo|violet|purple|rose|pink|slate|gray|zinc|neutral|stone|teal|cyan|lime)-[0-9]{2,3}" src`
- Primary color = the single most important action on the screen and the active nav item. Not
  for whole cards, ticket borders or every button.
- Status colors (success/warning/destructive) are reserved for state and always ship with a word
  or icon. `destructive` is only for destroying/irreversible actions and real errors/overdue states —
  never for "Start cooking" or normal progress.
- No gradients, glows or glassmorphism. Depth comes from `surface` (1px border + `shadow-card`);
  overlays use `shadow-pop`.

## 2. Type, spacing, radius

- Font: Geist (sans) / Geist Mono only for codes (SKU, order #). Numbers use `tabular`.
- Scale: page title 22–26px semibold (`PageHeader`), section title 13.5–15px semibold, body 14px,
  meta 12px, eyebrow 11px uppercase (`eyebrow` utility). KPI values 22px; one hero number max 32px.
- Weights: 400 body, 500 labels, 600 titles/values. Never 700+ except the hero number.
- Spacing on a 4px grid: inside cards `p-4`/`p-5`, between cards `gap-4` (dense grids) or `gap-6`
  (sections). Page max width `max-w-[1440px] mx-auto`.
- Radius: `rounded-md` controls, `rounded-xl` (`surface`) cards, `rounded-full` only for avatars/dots.

## 3. Components — reuse, don't fork

| Need | Use |
|---|---|
| Page title + actions | `PageHeader` (`src/components/app/page.tsx`) |
| Card / section | `Panel` or the `surface` utility |
| KPI | `StatTile` (`src/components/app/stat-tile.tsx`) — value in foreground ink, tone dot only |
| Status pill | `Badge` variants `success · warning · danger · neutral · outline` |
| Tabs / segmented filter | `Tabs` (ui) or `Segmented` (`page.tsx`) |
| Empty / loading / error | `EmptyState`, `StateCard`, `Skeleton` (`src/components/app/states.tsx`) |
| Buttons | `Button` variants: `default` (one primary per view), `outline`/`secondary` (secondary), `ghost` (tertiary/icon), `destructive` (delete/cancel-with-effect only) |
| Demo figures | `DemoBadge` + the `demo-stripe` utility — mandatory on any synthetic number |
| Confirm a destructive action | `AlertDialog`, never `window.confirm` |

Never create a second version of an existing component. If a variant is missing, add it to the
existing component (as was done for `Badge`).

## 4. Layout and information hierarchy

- Every screen answers: *what needs my attention now, what happened, what can I do*. Order content
  that way: alerts/KPIs → primary work area → detail tables.
- KPI rows: 3–5 `StatTile`s. A card that does not change a decision is removed or merged.
- Empty blocks are bugs: if a chart has no data, render `EmptyState` with the reason and the action
  that fills it — never a blank canvas.
- When the store switcher is "All stores", every row/card that belongs to a store shows the store
  name. Duplicated-looking rows are a defect.
- Tables: right-align money/quantities with `tabular`; dates via `fmtDate`; sticky header for long
  lists; max ~8 columns; actions in the last column as ghost icon buttons with `aria-label`.
- Responsive: design at 1440, verify at 768 and 390. Sidebar collapses; grids drop to 1–2 columns;
  no horizontal page scroll (tables may scroll inside their own container).

## 5. Charts

Follow the built-in **dataviz** skill. In Servora: one axis, thin marks, recessive grid, tokens
`chart-1..6` in fixed order, legend for ≥2 series, tooltip on hover, `EmptyState` when no data.
A single number is a `StatTile`, not a chart. No pies/donuts — use ranked bars.

## 6. Numbers, money, dates, language

- Money in the DB is **integer cents**. Display with `fmtMoneyCents(cents, lng)` — never
  `fmtCurrency(cents)`; never divide by hand in JSX.
- Quantities: `fmtQuantity(v, lng)` (≤2 decimals). Tax rates in basis points: `fmtBasisPoints`.
  Percentages: `fmtPercent` (input is a ratio, 0.187 → 18.7%).
- Dates: `fmtDate` with the active language; never print ISO strings.
- Every user-visible string comes from `src/locales/<lang>/<namespace>.json` via `useTranslation`
  (pt-BR and en-US must both be complete). Never translate data: product, store, supplier, customer
  and restaurant names are shown as stored. Never show technical ids/slugs/audit keys to users —
  map them to labels (e.g. category `client_id` → category name; `orders.created` → "Order created").
- Order numbers come from the DB already prefixed with `#`; don't add another.

## 7. Data honesty (non-negotiable)

- Show only what the backend recorded. No hard-coded deltas ("+12.4%"), fake trends, or invented
  growth. If a comparison period has no data, say so.
- Synthetic figures exist only for `org.fictional` tenants or labelled demo areas, always with
  `DemoBadge`.
- A button must do what it says. If the backend refuses an action in a given state (e.g. receiving a
  draft PO), hide or disable it with a reason — never let the user hit a server error.
- Success toasts only after the server confirmed.

## 8. Imagery

- Food photography only where it sells: menu catalogue, POS tiles, product detail, menu preview.
  Not in tables, KDS, finance or admin.
- Local, optimised assets in `public/media/menu/` (WebP, 4:3, ≤ 1200px wide, ≤ 180 KB), licensed or
  generated — record source/license in `public/media/menu/CREDITS.md`. No hot-linked URLs.
- Always `alt` (dish name), `loading="lazy"`, `decoding="async"`, fixed aspect ratio with
  `object-cover` so the grid never jumps. Without an image show a neutral placeholder of the same ratio.

## 9. Interaction states

Every interactive element has visible hover, `focus-visible` ring (global `:focus-visible` style),
disabled (`disabled` attribute + reason in tooltip/text) and loading (spinner or `aria-busy`, button
disabled while pending to keep operations idempotent). Icon-only buttons need `aria-label`.
Hit targets ≥ 36px on desktop, ≥ 44px on touch screens (POS, KDS).

## 10. Definition of done for any UI change

1. `npx tsc --noEmit`, `npm run lint`, `npm run test`, `npm run build` pass.
2. Opened in the browser as a real role (owner/manager/staff) with real data, in **pt-BR and en-US**,
   **light and dark**, at **1440 / 768 / 390** widths.
3. Numbers cross-checked against the database for at least one record.
4. Drift grep in §1 returns nothing new for touched files; no new hard-coded strings.
5. Security untouched: no client-side writes outside the existing server functions/RPCs, store scope
   respected, nothing that weakens RLS.
