# Dinequora — Marketing Website

Public website for **Dinequora — Restaurant Intelligence Platform**. It is a standalone
Vite + React + TypeScript + Tailwind CSS v4 site, the same front-end stack as the Dinequora
restaurant application. It lives in `website/` of the Servora repository but is a separate
project: its own `package.json`, lockfile, lint config and CI job (`.github/workflows/website.yml`).
It does not import anything from the app, and the app's lint/typecheck/tests ignore this folder.

## Run locally

```bash
cd website
npm install
npm run dev        # http://localhost:5180
npm run build      # typecheck + production build into dist/
npm run preview    # serve dist/ at http://localhost:5181
npm test           # vitest
npm run lint
npm run typecheck
```

## Configuration (`.env`, see `.env.example`)

| Variable | Purpose | If empty |
| --- | --- | --- |
| `VITE_APP_URL` | Base URL of the restaurant app. **Login** → `<url>/auth`, **Create account** → `<url>/signup`. | Relative `/auth` and `/signup` (same domain). For local work, put `VITE_APP_URL=http://localhost:8080` (or your app dev port) in `website/.env.local` (git-ignored). |
| `VITE_DEMO_REQUEST_ENDPOINT` | URL that receives demo requests as JSON `POST`. | Form validates, then opens **WhatsApp** (sales line) with the request pre-filled. The visitor sends it themselves; the site never claims it was delivered. |
| `VITE_SITE_URL` | Public URL of this site. Adds `<link rel=canonical>`, `og:url`, and absolute OG image URLs at build time. | Relative OG image (some social crawlers will not show it). |

Demo request JSON payload: `name, email, restaurant, phone|null, locations, role, message|null, consent, language ("en"|"pt"), source, submittedAt`.
`locations` and `role` are always sent as the English option values, whatever language the visitor used.

## Sales WhatsApp

The official sales line, **+1 (508) 714-9654**, is set in `src/config/site.ts` (`WHATSAPP`). It appears in:
- the header (pill, on screens ≥1280px) and the mobile menu,
- a floating button (after the hero; hidden over the contact section),
- the footer,
- the demo form, which hands the request to WhatsApp while no form backend is configured.

All links use `https://wa.me/15087149654` with a greeting in the visitor's language and open in a new tab.

## Languages (English / Portuguese)

The site is available in **English** (default) and **Brazilian Portuguese**, switched with the **EN | PT** control in the header.

- Initial language: `?lang=en|pt` in the URL, else the visitor's last choice (localStorage), else the browser language, else English. Switching updates the URL (`/?lang=pt`), `<html lang>`, the page title and the meta description.
- Each piece of copy lives next to its translation (`t("English", "Português")` / `{ en, pt }` objects). Prices, plan inclusions and Available / Rolling-out statuses are defined once and shared by both languages, so the two versions cannot disagree.
- Prices stay in US dollars in both languages (`$49` / `US$ 49`).
- Product mockups are translated in the Portuguese version (sidebar, panels, statuses, sample dishes; amounts shown as `US$ 2.184,00`). The application itself is in English today, so the Portuguese captions and FAQ say the screens are translated for illustration only. Proper names (locations, suppliers, people) are not translated.
- With `VITE_SITE_URL` set, the build adds `hreflang` alternates for both versions.

## Where things live

- `src/config/pricing.ts` — **single source of truth for prices** (plans, implementation fees, comparison table). Edit prices here only; tests guard the approved values.
- `src/config/site.ts` — navigation, app routes, env handling.
- `src/content/features.ts` — feature catalog with an availability status per capability.
- `src/content/copy.ts` — implementation steps, AI roadmap, FAQ.
- `src/components/mockups/` — static recreations of real app screens (labels, columns, and statuses mirror the app; all figures are labeled sample data).
- `public/brand/` — official Dinequora SVG Brand Kit files, copied unmodified.
- `public/images/` — optimized WebP photography (see credits).

## Feature verification (against the app codebase, Nov 2026)

Marked **Available**: POS (records payment method; no card processing), KDS, live order flow POS → kitchen,
menu management, inventory tracking, stock movements, suppliers, purchase orders, receiving, expense tracking,
financial reports (7 types; CSV / Excel-compatible XML / print-to-PDF), revenue by location, employee accounts,
owner/manager/staff roles, location-specific access, activity log, multi-location comparison (Finance), plan store limits (1 / 3 / 50).

Marked **Rolling out** (partially built): order history view, recipe costing, food cost / COGS reporting,
financial dashboard trend chart, cash flow *projections* (historical statements exist), executive performance
dashboard on live data, sales/product performance, operational alerts.

Presented as **upcoming only** (not in any plan): all AI capabilities. No integrations, payment processing,
hardware, or payroll are claimed.

## Photography credits

Photos from [Unsplash](https://unsplash.com) under the Unsplash License (free commercial use). Source IDs:

| File | Unsplash photo ID |
| --- | --- |
| hero-dining.webp | photo-1653259038915-7cf0b7a4dd6c |
| interior-moody.webp | photo-1552960226-639240203497 |
| interior-modern.webp | photo-1517248135467-4c7edcad34c4 |
| chef-plating.webp | photo-1577106263724-2c8e03bfe9cf |
| plating-line.webp | photo-1488992783499-418eb1f62d08 |
| kitchen-line.webp | photo-1744413922773-26a3b277411f |
| kitchen-fire.webp | photo-1589293053074-e5499abade96 |
| dish-dark.webp | photo-1499715217757-2aa48ed7e593 |
| dish-black.webp | photo-1725092292933-015656d6eeed |
| manager-tablet.webp | photo-1758519289791-ffce8889ca8c |
| service-tablet.webp | photo-1777680174389-e98bc55d8265 |

## Before production

1. Set `VITE_DEMO_REQUEST_ENDPOINT` to a real form backend (and a privacy policy that covers it).
2. Set `VITE_APP_URL` to the deployed app URL and `VITE_SITE_URL` to this site's URL.
3. Add Privacy Policy and Terms pages (not included; no links to them were invented).
4. Confirm Enterprise terms and the implementation timeline you will commit to.
5. Re-check “Rolling out” labels as features ship (`src/content/features.ts`, `src/config/pricing.ts`).
