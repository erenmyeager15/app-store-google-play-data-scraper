export type SourceName = 'app_store' | 'google_play';

export interface ProxyInput {
  useApifyProxy?: boolean;
  apifyProxyGroups?: string[];
  apifyProxyCountry?: string;
  proxyUrls?: string[];
}

export interface ActorInput {
  sources?: SourceName[];
  searchQueries?: string[];
  appIds?: string[];
  packageNames?: string[];
  country?: string;
  language?: string;
  includeRatingsSummary?: boolean;
  trackChanges?: boolean;
  monitorName?: string;
  observationHistoryLimit?: number;
  maxResults?: number;
  userAgent?: string;
  proxyConfiguration?: ProxyInput;
}

export interface NormalizedInput {
  sources: SourceName[];
  searchQueries: string[];
  appIds: string[];
  packageNames: string[];
  country: string;
  language: string;
  includeRatingsSummary: boolean;
  trackChanges: boolean;
  monitorName: string;
  observationHistoryLimit: number;
  maxResults: number;
  userAgent: string;
  proxyConfiguration?: ProxyInput;
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
  recordKey: string;
  appId: string;
  bundleId: string | null;
  appName: string;
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
  appUrl: string;
  country: string;
  language: string;
  scrapedAt: string;
  monitorName?: string | null;
  monitoringStatus?: 'baseline' | 'updated' | 'unchanged' | 'partial' | null;
  firstSeenAt?: string | null;
  previousSeenAt?: string | null;
  observationCount?: number | null;
  changedFields?: string[];
  previousPrice?: number | null;
  priceDelta?: number | null;
  priceChanged?: boolean | null;
  previousCurrency?: string | null;
  previousRatingValue?: number | null;
  ratingValueDelta?: number | null;
  previousRatingCount?: number | null;
  ratingCountDelta?: number | null;
  ratingsPerDay?: number | null;
  previousInstallRange?: string | null;
  previousVersion?: string | null;
  versionChanged?: boolean | null;
  previousLastUpdated?: string | null;
  daysSinceStoreUpdate?: number | null;
  growthSignals?: string[];
}

export interface AppObservation {
  checkedAt: string;
  price: number | null;
  currency: string | null;
  ratingValue: number | null;
  ratingCount: number | null;
  installRange: string | null;
  version: string | null;
  lastUpdated: string | null;
}

export interface AppMonitoringState {
  schemaVersion: 1;
  firstSeenAt: string;
  observationCount: number;
  history: AppObservation[];
}

export type SourceJobOutcome = 'success' | 'partial' | 'failed';

export interface SourceJobResult {
  records: AppRecord[];
  warnings: string[];
  outcome: SourceJobOutcome;
}

export interface SourceWarning {
  source: SourceName;
  operation: string;
  message: string;
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
  currency?: string;
  averageUserRating?: number;
  userRatingCount?: number;
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

export interface GooglePlayClient {
  search(options: Record<string, unknown>): Promise<unknown>;
  app(options: Record<string, unknown>): Promise<unknown>;
}
