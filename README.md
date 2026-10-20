# Tenang — calm budgeting for Indonesian students in Beijing

**Topic C · Cross-border & Student Finance Assistant**

Tenang helps Indonesian students moving from Jakarta to Beijing plan their money before they fly. It shows every cost in yuan and rupiah with a live exchange rate, and it explains prices in things students already know from home.

## Features

| Feature | What it does |
| --- | --- |
| **Budget** | Pick housing (dorm, shared flat, studio) and food style (canteen, mixed, eating out), edit transport, phone, study and other costs, and set fun money with a slider. Shows the monthly total in ¥ and Rp with a breakdown. |
| **Tip for you** | Friendly money tips. Tips that match your budget come first and say why (for example, "Because you picked Studio apartment"). |
| **Price feel** | Converts a Beijing price into rupiah and Jakarta equivalents (es kopi susu, TransJakarta, warung nasi goreng, Telkomsel packs). Pick an item or type your own price. |
| **Transfer check** | Compares up to 3 remittance quotes by the yuan that actually arrives, the hidden rate margin and the true cost. Simulation only: Tenang never sends money. |
| **Live or manual rate** | In Transfer check, choose **Live rate** (fetched automatically) or **Manual (fixed) rate** (for example, your bank's rate). The choice applies to the whole app and is saved in the browser. |

## How the live exchange rate works

1. Tenang asks three free public APIs (no API key) at the same time:
   - [ExchangeRate-API open access](https://open.er-api.com)
   - [Frankfurter (ECB reference rates)](https://frankfurter.dev)
   - [fawazahmed0 currency-api on jsDelivr](https://github.com/fawazahmed0/exchange-api)
2. Each value must be between Rp 1,500 and Rp 3,500 per ¥1, otherwise it is ignored.
3. Tenang uses the **median** of the valid values, so one wrong source cannot change the rate.
4. The result is cached for 6 hours. If all sources fail, Tenang uses the last known rate, then the example rate Rp 2,250, and says so in the header.

## Project structure

```
tenang-app/
├── index.html   page structure and Content-Security-Policy
├── styles.css   design (cream, jade, coral; Bricolage Grotesque + Instrument Sans)
├── app.js       all logic: budget, tips, price feel, transfer check, exchange rate
└── README.md
```

No framework, no build step, no backend.

## Run locally

```bash
git clone <your-repo-url>
cd tenang-app
python3 -m http.server 8080
# open http://localhost:8080
```

You can also double-click `index.html` to open it directly in the browser.

## Deploy (GitHub Pages)

1. Push the four files to a GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
4. After about a minute the app is live at `https://<username>.github.io/<repository>/`.

Netlify, Vercel and Cloudflare Pages also work: no build command, publish directory = repository root.

## Test cases

Run these in the browser after opening the app.

| ID | Feature | Steps | Expected result |
| --- | --- | --- | --- |
| TC01 | Budget | Open the app with default choices | Total ¥3,500; breakdown lists Housing ¥900, Food ¥1,500, Transport ¥150, Phone & data ¥50, Study ¥100, Other ¥200, Fun ¥600 |
| TC02 | Budget | Choose Studio apartment and Restaurant regular | Total ¥8,900; comment warns that the budget is high |
| TC03 | Budget | Type `abc` or `-50` in Transport and press Tab | Input is rejected and the old value comes back |
| TC04 | Budget | Move the Fun money slider to ¥1,200, reload the page | Slider and total keep the new value (saved in the browser) |
| TC05 | Tip for you | Choose Restaurant regular, open Tip for you | First tip is "The canteen rule" with "Because you picked Restaurant regular" |
| TC06 | Tip for you | Press Next tip and Previous | Tips cycle; the list on the right highlights the current tip |
| TC07 | Price feel | Pick Café latte at rate Rp 2,250 | ¥30 = Rp 67.500, feels like ≈ 3.1 glasses of es kopi susu |
| TC08 | Price feel | Type `100` in "your own price" | ¥100 = Rp 225.000 at Rp 2,250 |
| TC09 | Transfer check | Send Rp 5.000.000; quote fee Rp 50.000, rate 2300; market rate 2250 | Arrives ¥2,152.17; rate margin +2.22%; true cost Rp 157.609 (3.15%) |
| TC10 | Transfer check | Keep the three example quotes | Best provider is marked ★ and the verdict says how many more yuan it delivers |
| TC11 | Rate form | Choose Manual rate, type `9999`, press Use this rate | Error: rate must be between Rp 1.500 and Rp 3.500 per ¥1; nothing changes |
| TC12 | Rate form | Choose Manual rate, type `2.300`, press Use this rate | Header shows "¥1 = Rp 2.300 · manual rate"; Budget, Price feel and Transfer check use 2,300 |
| TC13 | Rate form | Reload the page after TC12 | Manual rate is still selected |
| TC14 | Rate form | Choose Live rate, press Use this rate | Header shows the live rate with a green dot (or "offline" if the APIs are unreachable) |
| TC15 | Rate | Turn off the internet and clear site data, then reload | Header shows "offline, example rate" (Rp 2.250); the app still works |
| TC16 | Security | In DevTools, set localStorage `tenang.simple.v1` to `{"housing":"<script>","costs":{"fun":-5},"manualRate":99,"rateMode":"manual"}` and reload | Invalid values are ignored; defaults are used; no script runs |

## Security and privacy

- All data stays in the browser (localStorage). No account, no server, no bank connection, no tracking.
- Tenang never moves money; Transfer check is a calculator only.
- User text is always written with `textContent`, never `innerHTML`.
- The Content-Security-Policy allows scripts only from the app itself and network requests only to the three exchange-rate APIs.
- Every number from input or storage is validated (allowed range, valid option) before use.
- Rate requests carry no user data, no cookies and no referrer.

## Credits

Exchange rates: ExchangeRate-API, Frankfurter (ECB), fawazahmed0 currency-api. Fonts: Bricolage Grotesque and Instrument Sans (SIL Open Font License, via Google Fonts). Beijing prices are typical student costs from public cost-of-living data (2026) and can be edited in the app.