# Tenang — a calm budgeting agent for Indonesian students in Beijing

**Topic C · Cross-border & Student Finance Assistant** (Fintechathon International Track, theme "AI as a Financial Participant")

Tenang is an on-device AI budgeting agent. A student types expenses and questions in plain words ("lunch canteen 14", "es kopi Rp 22.000", "can I afford ¥300 shoes?"). The agent records spending in yuan and rupiah with a live exchange rate, tracks the month against a Beijing budget, compares remittance quotes by what actually arrives, and explains every decision. It works under four permission tiers and **never moves money**.

## Features

| Area | What it does |
| --- | --- |
| Agent (Today) | Plain-language input → intent, amount, currency, date, category. Tier 0–3 policy with confirmation cards and reasons. |
| Live FX | CNY→IDR from 3 key-less public APIs, cross-checked (median, 2% disagreement warning), 6-hour cache, safe fallback. |
| Budget | Beijing plan builder (housing, food, fun slider, other categories), per-category progress. |
| Insights | Safe-to-spend today, end-of-month projection, categories running ahead, anomaly detection. |
| Expenses | Manual add, filter, recategorise (agent learns the word), delete with confirmation, CSV export (formula-injection safe). |
| Transfer check | Ranks remittance quotes by yuan received and true cost (fee + hidden rate margin). Simulation only. |
| Price feel | Converts a Beijing price into rupiah and familiar Jakarta items. |
| Activity log | SHA-256 hash-chained log of every user, agent and system action; integrity check; JSON export (execution evidence). |
| Settings | Auto-add limit, "confirm everything", fixed rate override, export/import (validated), sample month, delete all. |

## Run locally

No build step, no dependencies, no account.

```bash
git clone <your-repo-url>
cd tenang-app
# Option 1: open index.html directly in Chrome, Edge, Firefox or Safari
# Option 2 (recommended): serve over http
python3 -m http.server 8080
# then open http://localhost:8080
```

Click **Load sample month** (Today or Settings) to try every feature with a sandbox account.

## Deploy

Any static host works, because the app is plain HTML, CSS and JavaScript.

- **GitHub Pages:** push the folder to a repository → Settings → Pages → Deploy from branch → `main` / root. The app is served over HTTPS at `https://<user>.github.io/<repo>/`.
- **Netlify / Vercel / Cloudflare Pages:** create a new site from the repository, no build command, publish directory = repository root.

Recommended production headers (the page already ships a Content-Security-Policy meta tag): `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `frame-ancestors 'none'` in the CSP header.

## Tests

Open `tests/index.html` in a browser (or `http://localhost:8080/tests/`). 30 test cases run automatically and print pass/fail.

| ID | Covers |
| --- | --- |
| TC01–TC05 | Number, money, currency and date parsing (Indonesian and English formats) |
| TC06–TC07 | Category classifier and learning from corrections |
| TC08–TC10 | Intent detection; tier-3 blocking of money movement, trading, credentials |
| TC11–TC13 | Permission policy: auto, confirm, rate limit |
| TC14–TC16 | Month insights, overspend detection, anomaly z-score |
| TC17–TC18 | Remittance analysis and ranking |
| TC19–TC21 | FX engine: median, outlier rejection, disagreement warning, cache and fallback |
| TC22–TC23 | SHA-256 test vector, hash-chain tamper detection |
| TC24 | Data validation and inert text (XSS strings stay plain text) |
| TC25–TC30 | Agent end to end: auto add, rupiah conversion, confirmation, decline, block, invalid amounts |

## Project structure

```
index.html            app shell, CSP, views
css/styles.css        design system (Tenang palette, responsive)
js/utils.js           formatting, validation, safe DOM builder
js/fx.js              live exchange-rate engine
js/audit.js           SHA-256 hash-chained activity log
js/store.js           local data store + schema validation
js/agent.js           parser, classifier, insights, anomaly, policy, transfer analysis
js/agent-runtime.js   agent: message → policy → tool → explanation → log
js/demo.js            seeded sample month (sandbox account)
js/app.js             UI controller
tests/                browser test runner + 30 test cases
```

## Data sources

Exchange rates: [ExchangeRate-API open access](https://open.er-api.com), [Frankfurter (ECB)](https://frankfurter.dev), [fawazahmed0/currency-api](https://github.com/fawazahmed0/exchange-api). Beijing student prices are typical public cost-of-living figures (2026), editable by the user. Fonts: Bricolage Grotesque and Instrument Sans (SIL Open Font License, Google Fonts).

## Privacy and safety

All data stays in the browser's localStorage. There is no server, no bank connection, no tracking and no credentials. The agent cannot send, pay, trade or withdraw. See the technical documentation for the full security design and known risks.
