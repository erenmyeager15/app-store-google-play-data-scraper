# App Store & Google Play Data Scraper

Collect normalized, non-personal app metadata from the Apple App Store and Google Play into one Apify dataset for ASO, competitor tracking, app-market research, pricing/version monitoring, and product intelligence.

This Actor focuses on app-level public metadata and aggregate ratings. It does not collect individual reviews, reviewer identities, developer contact fields, emails, phone numbers, or user-level data.

## What It Extracts

- App identity: app name, Apple app ID, bundle ID, Google Play package name, app URL, and store source.
- Publisher and category data: developer company or studio name, category, country/region, and language.
- Commercial data: price, currency, Google Play install range when available, version, content rating, release date, and last update date.
- Aggregate ratings only: rating value, rating count, and Google Play rating histogram when available.
- Store media: icon URL, screenshots, and redacted app description.

## Supported Sources

| Source | Input value | Lookup inputs | Best for |
| --- | --- | --- | --- |
| Apple App Store | `app_store` | Apple numeric app IDs, bundle IDs, or keyword search | iOS app metadata, ratings summary, price, version, release/update dates |
| Google Play Store | `google_play` | Package names, Google Play URLs, or keyword search | Android app metadata, ratings summary, histogram, installs, price, version, screenshots |

Apple data is fetched through public iTunes Search and Lookup APIs. Google Play data is fetched from public app-level metadata pages through the app metadata library used by the Actor.

## Use Cases

- ASO keyword and competitor research
- Cross-store app-market intelligence
- Pricing, version, and update monitoring
- Category and publisher benchmarking
- App portfolio monitoring for agencies, publishers, and investors
- Lightweight market sample datasets for reports and dashboards

## Quick Start

### Search both stores for a keyword

```json
{
  "sources": ["app_store", "google_play"],
  "searchQueries": ["whatsapp"],
  "country": "us",
  "language": "en",
  "includeRatingsSummary": true,
  "maxResults": 10
}
```

### Look up one app on both stores

```json
{
  "sources": ["app_store", "google_play"],
  "appIds": ["310633997"],
  "packageNames": ["com.whatsapp"],
  "country": "us",
  "language": "en",
  "includeRatingsSummary": true,
  "maxResults": 10
}
```

### Search Google Play only

```json
{
  "sources": ["google_play"],
  "searchQueries": ["fitness tracker"],
  "country": "in",
  "language": "en",
  "includeRatingsSummary": true,
  "maxResults": 20
}
```

## Input Fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `sources` | array | `["app_store", "google_play"]` | Select `app_store`, `google_play`, or both. |
| `searchQueries` | array | `["whatsapp"]` | Keywords to search in selected stores. |
| `appIds` | array | Empty | Apple numeric app IDs, App Store URLs, or bundle IDs. Example: `310633997`. |
| `packageNames` | array | Empty | Google Play package names or app URLs. Example: `com.whatsapp`. |
| `country` | string | `us` | Store country/region code, such as `us`, `in`, or `gb`. |
| `language` | string | `en` | Language/locale code. |
| `includeRatingsSummary` | boolean | `true` | Include aggregate ratings and Google Play histogram when available. Individual reviews are never output. |
| `maxResults` | integer | `10` | Maximum clean app metadata records to save across selected sources, capped at `1000`. |
| `userAgent` | string | `AppStoreGooglePlayDataScraper/1.0 app-market-research` | Descriptive User-Agent for public API/page requests. |
| `proxyConfiguration` | object | No proxy | Optional for Google Play rate limits. Apple iTunes API does not need a proxy. |

If no search terms or direct IDs are provided, the Actor uses a safe WhatsApp sample: keyword `whatsapp`, Apple app ID `310633997`, and Google Play package `com.whatsapp`.

## Output Overview

Each dataset item is one clean app-level record.

| Field group | Example fields |
| --- | --- |
| Store and identity | `source`, `query`, `appId`, `bundleId`, `appName`, `appUrl`, `country`, `scrapedAt` |
| Publisher and category | `developer`, `category`, `contentRating` |
| Price and availability | `price`, `currency`, `installRange` |
| Ratings summary | `ratingValue`, `ratingCount`, `ratingHistogram` |
| Version and dates | `version`, `releaseDate`, `lastUpdated` |
| Media and text | `description`, `iconUrl`, `screenshots` |

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
  "releaseDate": "2010-10-18T00:00:00.000Z",
  "lastUpdated": "2026-06-01T00:00:00.000Z",
  "description": "Simple. Reliable. Private messaging...",
  "iconUrl": "https://...",
  "screenshots": ["https://..."],
  "appUrl": "https://play.google.com/store/apps/details?id=com.whatsapp",
  "country": "us",
  "scrapedAt": "2026-06-14T00:00:00.000Z"
}
```

## Tips For Better Results

- Use direct IDs for exact app monitoring: Apple app IDs or bundle IDs for iOS, package names for Google Play.
- Use keyword searches for market discovery, category comparisons, and competitor mapping.
- Set `country` to the market you care about because price, availability, ranking, and metadata can vary by region.
- Keep `maxResults` small for exploratory searches, then increase it once the query and region are right.
- If Google Play starts rate-limiting repeated workloads, enable a proxy configuration. Apple iTunes API requests usually do not need a proxy.

## Known Limits

- The Actor collects app-level public metadata, not individual review text or reviewer profiles.
- Google Play install range is approximate and only available when the source exposes it.
- Apple and Google store pages can vary by country, language, and source availability.
- Descriptions are redacted for email/phone-like text before output.
- Ratings and update timestamps reflect the store data available at run time.

## Pricing

This Actor uses pay-per-event pricing.

| Event | When charged | Price |
| --- | --- | --- |
| `app-scraped` | One clean non-personal app metadata record saved | `$0.001` |

Each clean app record is saved and charged atomically. Collection stops before further store requests when the user's spending limit is reached.

## Data Safety

This Actor is designed for non-personal app and publisher metadata only. It does not output individual reviews, reviewer names, reviewer handles, developer emails, phone numbers, or contact fields.

## Responsible Use

This Actor is intended for lawful collection and processing of publicly available information only. Users are responsible for ensuring their use complies with source terms, applicable privacy laws, and all local regulations.

Do not use this Actor to collect, store, sell, or misuse personal data without a lawful basis. The Actor author is not responsible for misuse by end users.

## License

Apache-2.0
