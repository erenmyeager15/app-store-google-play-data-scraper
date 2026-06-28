# App Store & Google Play Data Scraper

Aggregate non-personal app metadata from the Apple App Store and Google Play Store into one normalized Apify dataset for ASO, app-market research, competitor tracking, and product intelligence.

## What It Extracts

- App name, app ID, bundle ID/package name, developer company/studio name, category, price, currency, version, content rating, release date, update date, icon, screenshots, store URL, and redacted description.
- Aggregate ratings only: rating value, rating count, and Google Play rating histogram when available.
- Google Play install range when available.

This Actor does not output individual reviews, reviewer names, reviewer handles, developer emails, phone numbers, or contact fields.

## Sources

- Apple App Store via the official public iTunes Search and Lookup APIs.
- Google Play Store public app pages via app-level metadata fetching.

## Input

| Field | Type | Description |
| --- | --- | --- |
| `sources` | array | `app_store`, `google_play`, or both. |
| `searchQueries` | array | Keywords to search across selected stores. |
| `appIds` | array | Apple numeric app IDs or bundle IDs. |
| `packageNames` | array | Google Play package names or app URLs. |
| `country` | string | Store country/region code, default `us`. |
| `language` | string | Language code, default `en`. |
| `includeRatingsSummary` | boolean | Include aggregate ratings only. |
| `maxResults` | integer | Maximum app records across all selected sources. |
| `proxyConfiguration` | object | Optional for Google Play rate limits; Apple API does not need proxy. |

## Sample Output

```json
{
  "source": "google_play",
  "query": "whatsapp",
  "appId": "com.whatsapp",
  "bundleId": "com.whatsapp",
  "appName": "WhatsApp Messenger",
  "developer": "WhatsApp LLC",
  "category": "Communication",
  "price": 0,
  "currency": "USD",
  "ratingValue": 4.3,
  "ratingCount": 200000000,
  "ratingHistogram": {
    "oneStar": 1000000,
    "twoStar": 500000,
    "threeStar": 900000,
    "fourStar": 3000000,
    "fiveStar": 15000000
  },
  "installRange": "5,000,000,000+",
  "version": "Varies with device",
  "contentRating": "Everyone",
  "releaseDate": "2010-10-18",
  "lastUpdated": "2026-06-01T00:00:00.000Z",
  "description": "Simple. Reliable. Private messaging...",
  "iconUrl": "https://...",
  "screenshots": ["https://..."],
  "appUrl": "https://play.google.com/store/apps/details?id=com.whatsapp",
  "country": "us",
  "scrapedAt": "2026-06-14T00:00:00.000Z"
}
```

## Use Cases

- ASO keyword and competitor research.
- App-market intelligence and category monitoring.
- Pricing, version, and update tracking.
- Product benchmarking across Apple App Store and Google Play.
- Portfolio monitoring for publishers, agencies, and investors.

## Pricing

This Actor uses pay-per-event pricing.

| Event | When charged | Price |
| --- | --- | --- |
| `app-scraped` | One clean non-personal app metadata record saved | $0.001 |

Each clean app record is saved and charged atomically. Collection stops before further store requests when the user's spending limit is reached.

## Responsible Use

This Actor is intended for lawful collection of publicly available information only. Users are responsible for ensuring their use complies with the source website's terms, robots.txt, applicable privacy laws, including India's DPDP Act, and all local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0
