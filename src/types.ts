export type SourceName = 'app_store' | 'google_play';

export interface ActorInput {
  sources?: SourceName[];
  searchQueries?: string[];
  appIds?: string[];
  packageNames?: string[];
  country?: string;
  language?: string;
  includeRatingsSummary?: boolean;
  maxResults?: number;
  userAgent?: string;
  proxyConfiguration?: {
    useApifyProxy?: boolean;
    apifyProxyGroups?: string[];
    apifyProxyCountry?: string;
    proxyUrls?: string[];
  };
}

export interface NormalizedInput {
  sources: SourceName[];
  searchQueries: string[];
  appIds: string[];
  packageNames: string[];
  country: string;
  language: string;
  includeRatingsSummary: boolean;
  maxResults: number;
  userAgent: string;
  proxyConfiguration?: ActorInput['proxyConfiguration'];
}

export interface RatingHistogram {
  oneStar: number | null;
  twoStar: number | null;
  threeStar: number | null;
  fourStar: number | null;
  fiveStar: number | null;
}

export interface AppRecord {
  source: SourceName;
  query: string | null;
  appId: string;
  bundleId: string | null;
  appName: string | null;
  developer: string | null;
  category: string | null;
  price: number | null;
  currency: string | null;
  ratingValue: number | null;
  ratingCount: number | null;
  ratingHistogram: RatingHistogram | null;
  installRange: string | null;
  version: string | null;
  contentRating: string | null;
  releaseDate: string | null;
  lastUpdated: string | null;
  description: string | null;
  iconUrl: string | null;
  screenshots: string[];
  appUrl: string | null;
  country: string;
  scrapedAt: string;
}

export interface AppleSearchResponse {
  resultCount?: number;
  results?: AppleApp[];
}

export interface AppleApp {
  trackId?: number;
  bundleId?: string;
  trackName?: string;
  sellerName?: string;
  artistName?: string;
  primaryGenreName?: string;
  price?: number;
  formattedPrice?: string;
  currency?: string;
  averageUserRating?: number;
  userRatingCount?: number;
  averageUserRatingForCurrentVersion?: number;
  userRatingCountForCurrentVersion?: number;
  version?: string;
  contentAdvisoryRating?: string;
  trackContentRating?: string;
  releaseDate?: string;
  currentVersionReleaseDate?: string;
  description?: string;
  artworkUrl512?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
  screenshotUrls?: string[];
  ipadScreenshotUrls?: string[];
  appletvScreenshotUrls?: string[];
  trackViewUrl?: string;
  wrapperType?: string;
  kind?: string;
}
