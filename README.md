# Sanchi UDS: Company, Distributor and Retailer app

One web app (installable PWA, also built as an Android APK) for three kinds of users plus company staff:

| Who | What they do |
|---|---|
| **Admin** | Everything: masters, price lists, orders, payments, ledgers, dashboard, import, settings, branding |
| **Company assistant** | Approves/edits/dispatches distributor orders etc., as far as the admin allows (Settings) |
| **Distributor** | Adds retailers, approves retailer demands (editing quantity/rate), dispatches, takes payments, sends one order per AM/PM session to the company, sees the company ledger |
| **Retailer** | Places AM/PM demands at their own rate (MRP shown), sees dispatches, payments, ledger |

Stack (all free tier): GitHub (code + Actions) → Cloudflare Pages (app) + Cloudflare Worker (API, `api/`) + Cloudflare D1 (database, `migrations/`).

```
migrations/   database schema (applied automatically on deploy)
api/          Cloudflare Worker (Hono): auth, masters, demands, orders, ledgers, reports, import
app/          the web app (plain HTML/JS, no build step) + templates/ (Excel import template)
brand/        logo files            brand.config.json   name, colour, app id
tools/        rebrand script, local dev server, automated tests
.github/      workflows: deploy-api, deploy-app, build-apk
```

## 1. First-time setup (about 30 minutes)
1. **Cloudflare:** create a D1 database named `sanchi-db`; copy its ID into `api/wrangler.toml`. Create an API token with *Workers Scripts: Edit* and *D1: Edit*; note your Account ID. Create a **Pages** project named `sanchi-app` (Direct Upload; upload anything once).
2. **GitHub:** create a *private* repo and push this folder to `main`. In Settings > Secrets > Actions add `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `JWT_SECRET` (long random text) and `SETUP_KEY` (any secret word, used once).
3. **API address:** after the first "Deploy API" run, note the Worker URL (or attach your own sub-domain such as `api.yourdomain.com` under Worker > Triggers). Put it in `app/config.js` and push. Attach your app sub-domain under Pages > Custom domains.
4. **Create the admin** (works once only):
   `curl -X POST https://<api-url>/api/setup -H "Content-Type: application/json" -d '{"setup_key":"<SETUP_KEY>","name":"Admin","mobile":"9999999999","password":"choose-one"}'`
5. Open the app, log in as admin. Suggested order: Masters (Routes, Cities, Price lists, Products) → Distributors → everything else. Or import it all from Excel (below).
6. On phones: open the app address, choose **Add to Home screen** (works on iPhone too).

If login shows "405" or the app seems to use an old address, the browser cached an old `config.js`: open the app in a private tab or clear the site data. (`app/_headers` makes browsers re-check files on every load, so this only affects versions deployed before it was added.)

Ordering units: orders are taken in packs (nos, crate, jar, box, carton ...), never in litre/kg/g/ml, and final quantities (summaries, company orders, dispatches) are shown in the base unit. So set the base unit of packed goods to **nos** and add crate/box/jar/carton as conversions (1 crate = 12 nos). Products are grouped by product group in every order screen.

Panels (the pop-up sheets) do not close when you tap outside; they close with the X button, Cancel, the device Back button, or when the action finishes.

## 2. Day-to-day flow
Retailer demand (AM/PM) → distributor approves (edit qty/rate; rate is locked on the line) → distributor dispatches to the retailer (ledger debit at dispatch) → distributor sends the approved totals to the company for that session (blocked after the company-set cutoff; later ones go as supplementary orders) → company accepts/edits, dispatches in one or more shipments (ledger debit) → payments are recorded and ledgers balance. Payments are reversed, never deleted. Only the company can move a distributor's order between AM/PM; only the distributor can move a retailer's demand; a distributor can pull a demand out of a sent order until the company starts dispatching.

## 3. Excel import
Settings > **Import from Excel**. Download the template there (or use `app/templates/Sanchi_import_template.xlsx`), fill the sheets you need, upload. Sheets import in order (Routes, Cities, PriceLists, Products, Distributors, Retailers, OpeningBalances), rows that fail are listed with the Excel row number, and re-importing updates instead of duplicating. New people get temporary passwords in a downloadable login sheet. The reader loads from cdnjs, so you need internet while importing. Import in batches of a few distributors per day on the free plan (each retailer is about 2 database writes).

## 4. Dashboard
Company > Dashboard: sales to distributors or to retailers; filter by route, city, distributor, product group, product, AM/PM; trend with last year's line, a one-day comparison against the same day last year, last year's daily average and last month's daily average, and a breakdown by distributor, city, route, product, group or session. Quantity is shown only when one product is selected (mixed units cannot be added). Numbers come from small rollup tables updated at every dispatch. If they ever look wrong: `POST /api/admin/rebuild-sales` (admin) rebuilds them from the dispatch records.

## 5. Rebranding (name, colour, logo)
- Quick, no rebuild: Settings > Name / colour, Change logo.
- Full (home-screen icon, manifest, APK name): replace `brand/logo-512.png`, `brand/logo-192.png`, edit `brand.config.json`, push. Workflows pick it up.

## 6. Android APK
GitHub > Actions > **Build Android APK** > Run workflow. Download `app-debug-apk` from the run page and install it (allow "install unknown apps"). This is a debug-signed APK, fine for handing to distributors directly. For the Play Store you will later need a release-signed bundle (one-time $25 Google fee). The API address in `app/config.js` is baked into the APK, so rebuild it if that address ever changes. iOS: the PWA works now; a native iOS build later uses the same code (`npx cap add ios`, macOS runner, $99/year Apple fee).

## 7. Limits to know (Cloudflare free plan; check current numbers on their pricing page)
- Roughly 100k API requests and 100k database writes per day; 10 ms CPU per request; 5 GB database. This comfortably covers a pilot (a few thousand demands a day). Full scale (about 100 distributors with hundreds of retailers and 2 demands a day each) needs the **$5/month Workers paid plan**.
- Login uses PBKDF2 (`PBKDF2_ITER`, default 50000). If the free plan reports CPU-limit errors at login, lower it (old hashes keep working).
- Temporary passwords created by import use a light hash and must be changed at first login.
- Set the API's allowed origin more tightly (it is `*` now) once your domains are final, and keep the repo private.

## 8. Testing on your computer (Node 22+, no Cloudflare needed)
    cd api && npm install && cd ..
    node tools/devserver.mjs 8787        # real API code on an in-memory SQLite database
    node tools/api_test.mjs              # Phase 3 checks   (use a fresh server for each test file)
    node tools/api_test4.mjs             # Phase 4 checks
    node tools/api_test5.mjs             # Phase 5 checks (import, reports)
Browser tests (`tools/ui_test3.py`, `ui_test4.py`, `ui_test5.py`, Python + Playwright) drive the app against that server; point `app/config.js` at `http://localhost:8787` while testing and set it back afterwards.
