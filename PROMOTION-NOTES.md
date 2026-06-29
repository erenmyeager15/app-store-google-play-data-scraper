# App Store & Google Play Promotion Notes

## YouTube Tutorial Title Options

- How to Export App Store and Google Play Metadata with Apify
- App Store & Google Play Data Scraper: Track Apps, Ratings, Prices and Updates
- Build an ASO Competitor Dataset from Apple App Store and Google Play

## 60-Second Tutorial Script

1. Show the actor page: "This actor collects app-level public metadata from Apple App Store and Google Play."
2. Open the input form and keep both stores selected.
3. Search for a keyword such as `fitness tracker` or use direct IDs.
4. Set `country` to the target market, such as `us` or `in`.
5. Keep `includeRatingsSummary` enabled for aggregate ratings.
6. Set `maxResults` to `10` for the first run.
7. Run the actor.
8. Show dataset fields: `appName`, `developer`, `category`, `price`, `ratingValue`, `ratingCount`, `installRange`, `version`, `lastUpdated`, and `appUrl`.
9. Closing line: "Use this for ASO research and market monitoring, not individual review or user data collection."

## Short Post Copy

I polished an App Store & Google Play Data Scraper on Apify.

It collects non-personal app-level metadata from Apple App Store and Google Play into one normalized dataset for ASO, competitor research, market monitoring, and app portfolio tracking.

The output includes app IDs, package/bundle IDs, app names, developers, categories, prices, currencies, aggregate ratings, Google Play install ranges, versions, content ratings, release/update dates, icons, screenshots, store URLs, and country.

It intentionally avoids individual reviews, reviewer names, reviewer handles, developer emails, phone numbers, and contact fields.

Example input:

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

## SEO Keywords

- app store scraper
- Google Play scraper
- app metadata scraper
- ASO research data
- app competitor analysis
- app ratings dataset
- mobile app market intelligence
- Apify app store actor

## Promotion Guard

Keep examples app-level and aggregate. Do not position this as an individual review scraper, reviewer-profile scraper, contact scraper, lead-generation tool, or user-data collection tool.
