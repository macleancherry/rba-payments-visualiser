# RBA Payments Visualiser

A Cloudflare Pages-ready React dashboard for Australian RBA payments statistics, using original-series data only.

## What this app does

- Pulls all core original-series payments tables from RBA and compiles them into a local JSON dataset.
- Preserves clear separation by payment type, including cards by type (credit/charge, debit, prepaid), direct entry, NPP, PayTo, ATM, cheques and RTGS.
- Provides interactive filtering and charting with a modern MUI + Recharts frontend.
- Uses an expressive blue/teal design direction inspired by Fat Zebra brand cues.

## Data source policy

- Source page: https://www.rba.gov.au/payments-and-infrastructure/resources/payments-data.html
- Included tables: C1.1, C1.2, C2.1, C2.2, C4.1, C5.1, C6.1 and C7.
- Seasonally adjusted tables are excluded.

## Development

```bash
npm install
npm run data:refresh
npm run dev
```

## Build

```bash
npm run build
```

`npm run build` automatically refreshes the dataset before compiling.

## Cloudflare Pages deployment

This project is preconfigured with `wrangler.toml`:

- `pages_build_output_dir = "dist"`
- `compatibility_date = "2026-05-21"`

### Option 1: Git-connected Pages project

1. Push this repository to GitHub.
2. In Cloudflare Pages, create a new project from the repo.
3. Set Build command to `npm run build`.
4. Set Build output directory to `dist`.

### Option 2: Direct deploy with Wrangler

```bash
npm run build
npx wrangler pages deploy dist --project-name rba-payments-visualiser
```
