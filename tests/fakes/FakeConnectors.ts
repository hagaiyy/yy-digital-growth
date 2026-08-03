import type {
  FacebookManagedPage,
  FacebookTokenVerificationResult,
} from "@/application/connectors/FacebookConnector";
import type { AccountInsightsGroupResult, InstagramTokenSet } from "@/application/connectors/InstagramConnector";
import type { PinterestTokenSet } from "@/application/connectors/PinterestConnector";
import {
  ConnectorError,
  type MetricsFetchOutcome,
  type RecentContentItem,
  type VerifiedIdentity,
} from "@/application/connectors/types";
import type { ContentType } from "@/domain/models/ImportedContent";
import type { DataCompleteness } from "@/domain/models/PerformanceSnapshot";
import type { AccountMetricRecord } from "@/domain/models/AccountPerformanceSnapshot";

export { ConnectorError };

const DEFAULT_METRICS_OUTCOME: MetricsFetchOutcome = {
  kind: "success",
  metrics: { likes: 10, comments: 2, impressions: 100 },
  successfulMetrics: ["likes", "comments", "impressions"],
  failedMetrics: [],
  dataCompleteness: "complete",
};

export class FakeInstagramConnector {
  readonly platform = "instagram" as const;
  configured = true;
  missingConfigVars: string[] = [];

  exchangeResult: InstagramTokenSet | ConnectorError = {
    accessToken: "fake-instagram-long-lived-token",
    expiresAt: new Date(Date.now() + 60 * 24 * 3600_000).toISOString(),
  };
  connectedAccountResult: VerifiedIdentity | ConnectorError = {
    externalAccountId: "ig-external-id",
    displayName: "fake_instagram_user",
    accountType: "professional",
    grantedScopes: [],
  };
  verifyStillValidResult: VerifiedIdentity | ConnectorError = {
    externalAccountId: "ig-external-id",
    displayName: "fake_instagram_user",
    accountType: "professional",
    grantedScopes: [],
  };
  verifyCallCount = 0;
  fetchConnectedInstagramAccountCallCount = 0;

  recentContent: RecentContentItem[] | ConnectorError = [
    {
      externalContentId: "ig-item-1",
      contentType: "reel",
      caption: "Fake Instagram reel",
      permalink: "https://instagram.com/p/fake1",
      thumbnailUrl: "https://instagram.com/thumb1.jpg",
      publishedAt: "2026-07-29T05:00:00Z",
      platformData: { media_type: "VIDEO", media_product_type: "REELS" },
    },
  ];
  metricsOutcomeFor: (externalContentId: string) => MetricsFetchOutcome = () => DEFAULT_METRICS_OUTCOME;
  fetchRecentContentCallCount = 0;

  accountInsightsResult: AccountInsightsGroupResult[] = [];
  fetchAccountInsightsCallCount = 0;

  isConfigured(): boolean {
    return this.configured;
  }

  getMissingConfigVars(): string[] {
    return this.missingConfigVars;
  }

  buildAuthorizationUrl(state: string): string {
    return `https://www.instagram.com/fake-instagram-oauth?state=${state}`;
  }

  async exchangeCodeForToken(_code: string): Promise<InstagramTokenSet> {
    if (this.exchangeResult instanceof ConnectorError) throw this.exchangeResult;
    return this.exchangeResult;
  }

  async fetchConnectedInstagramAccount(_accessToken: string): Promise<VerifiedIdentity> {
    this.fetchConnectedInstagramAccountCallCount += 1;
    if (this.connectedAccountResult instanceof ConnectorError) throw this.connectedAccountResult;
    return this.connectedAccountResult;
  }

  async verifyAccountStillValid(_accessToken: string): Promise<VerifiedIdentity> {
    this.verifyCallCount += 1;
    if (this.verifyStillValidResult instanceof ConnectorError) throw this.verifyStillValidResult;
    return this.verifyStillValidResult;
  }

  async fetchRecentContent(
    _accessToken: string,
    _accountId: string,
    _limit: number,
  ): Promise<RecentContentItem[]> {
    this.fetchRecentContentCallCount += 1;
    if (this.recentContent instanceof ConnectorError) throw this.recentContent;
    return this.recentContent;
  }

  async fetchContentMetrics(
    _accessToken: string,
    externalContentId: string,
    _contentType: ContentType,
    _context: { likeCount?: number; commentsCount?: number },
  ): Promise<MetricsFetchOutcome> {
    return this.metricsOutcomeFor(externalContentId);
  }

  activeStories: RecentContentItem[] | ConnectorError = [];

  async fetchActiveStories(_accessToken: string, _accountId: string): Promise<RecentContentItem[]> {
    if (this.activeStories instanceof ConnectorError) throw this.activeStories;
    return this.activeStories;
  }

  async fetchAccountInsights(
    _accessToken: string,
    _accountId: string,
    _rawAccountType: string | undefined,
    _referenceHourIso: string,
  ): Promise<AccountInsightsGroupResult[]> {
    this.fetchAccountInsightsCallCount += 1;
    return this.accountInsightsResult;
  }
}

export class FakeFacebookConnector {
  readonly platform = "facebook" as const;
  configured = true;
  missingConfigVars: string[] = [];
  exchangeResult: string | ConnectorError = "fake-facebook-account-token";
  identityResult: VerifiedIdentity | ConnectorError = {
    externalAccountId: "fb-user-id",
    displayName: "Fake Facebook User",
    accountType: "personal",
    grantedScopes: [],
  };
  managedPages: FacebookManagedPage[] = [
    { id: "page-1", name: "Fake Page One", category: "Business", accessToken: "page-1-token" },
    { id: "page-2", name: "Fake Page Two", category: "Business", accessToken: "page-2-token" },
  ];
  pageVerifyResult: VerifiedIdentity | ConnectorError = {
    externalAccountId: "page-1",
    displayName: "Fake Page One",
    accountType: "Business",
    grantedScopes: [],
  };
  fetchIdentityCallCount = 0;

  pageContent: RecentContentItem[] | ConnectorError = [
    {
      externalContentId: "fb-post-1",
      contentType: "video",
      caption: "Fake Facebook Page post",
      permalink: "https://facebook.com/page/posts/fake1",
      thumbnailUrl: "https://facebook.com/thumb1.jpg",
      publishedAt: "2026-07-29T05:00:00Z",
      platformData: { likes_count: 5, comments_count: 1, shares_count: 0 },
    },
  ];
  pageMetricsOutcomeFor: (externalContentId: string) => MetricsFetchOutcome = () => DEFAULT_METRICS_OUTCOME;
  fetchPageContentCallCount = 0;

  isConfigured(): boolean {
    return this.configured;
  }

  getMissingConfigVars(): string[] {
    return this.missingConfigVars;
  }

  buildAuthorizationUrl(state: string): string {
    return `https://www.facebook.com/fake-oauth?state=${state}`;
  }

  async exchangeCodeForToken(_code: string): Promise<string> {
    if (this.exchangeResult instanceof ConnectorError) throw this.exchangeResult;
    return this.exchangeResult;
  }

  async fetchIdentity(_accessToken: string): Promise<VerifiedIdentity> {
    this.fetchIdentityCallCount += 1;
    if (this.identityResult instanceof ConnectorError) throw this.identityResult;
    return this.identityResult;
  }

  async fetchManagedPages(_accessToken: string): Promise<FacebookManagedPage[]> {
    return this.managedPages;
  }

  async verifyPageStillManaged(_pageId: string, _pageAccessToken: string): Promise<VerifiedIdentity> {
    if (this.pageVerifyResult instanceof ConnectorError) throw this.pageVerifyResult;
    return this.pageVerifyResult;
  }

  async fetchPageContent(
    _pageAccessToken: string,
    _pageId: string,
    _limit: number,
  ): Promise<RecentContentItem[]> {
    this.fetchPageContentCallCount += 1;
    if (this.pageContent instanceof ConnectorError) throw this.pageContent;
    return this.pageContent;
  }

  async fetchPagePostMetrics(
    _pageAccessToken: string,
    postId: string,
    _contentType: ContentType,
    _providerObjectType?: string,
  ): Promise<MetricsFetchOutcome> {
    return this.pageMetricsOutcomeFor(postId);
  }

  pageInsightsResult: { period: string; completeness: DataCompleteness; metrics: AccountMetricRecord[] } = {
    period: "day",
    completeness: "untested",
    metrics: [],
  };
  fetchPageInsightsCallCount = 0;

  async fetchPageInsights(
    _pageAccessToken: string,
    _pageId: string,
  ): Promise<{ period: string; completeness: DataCompleteness; metrics: AccountMetricRecord[] }> {
    this.fetchPageInsightsCallCount += 1;
    return this.pageInsightsResult;
  }

  tokenVerificationResult: FacebookTokenVerificationResult = {
    userToken: {
      valid: true,
      belongsToApp: true,
      hasReadInsights: true,
      hasPagesReadEngagement: true,
      hasPagesReadUserContent: true,
    },
    pageToken: { valid: true, belongsToApp: true, belongsToExpectedPage: true },
    pageIdMatches: true,
  };

  async verifyTokenState(
    _userAccessToken: string,
    _pageAccessToken: string,
    _expectedPageId: string,
  ): Promise<FacebookTokenVerificationResult> {
    return this.tokenVerificationResult;
  }
}

export class FakePinterestConnector {
  readonly platform = "pinterest" as const;
  configured = true;
  missingConfigVars: string[] = [];
  exchangeResult: PinterestTokenSet | ConnectorError = {
    accessToken: "fake-pinterest-token",
    refreshToken: "fake-pinterest-refresh-token",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
  identityResult: VerifiedIdentity | ConnectorError = {
    externalAccountId: "fake_pinterest_user",
    displayName: "fake_pinterest_user",
    accountType: "business",
    grantedScopes: ["user_accounts:read"],
  };
  refreshResult: PinterestTokenSet | ConnectorError = {
    accessToken: "refreshed-pinterest-token",
    refreshToken: "refreshed-pinterest-refresh-token",
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };

  recentPins: RecentContentItem[] | ConnectorError = [
    {
      externalContentId: "pin-1",
      contentType: "pin",
      title: "Fake Pin",
      caption: "Fake Pinterest pin",
      permalink: "https://www.pinterest.com/pin/pin-1/",
      thumbnailUrl: "https://pinterest.com/thumb1.jpg",
      publishedAt: "2026-07-29T05:00:00Z",
      platformData: { media_type: "image" },
    },
  ];
  pinAnalyticsOutcomeFor: (pinId: string) => MetricsFetchOutcome = () => DEFAULT_METRICS_OUTCOME;
  fetchRecentPinsCallCount = 0;

  isConfigured(): boolean {
    return this.configured;
  }

  getMissingConfigVars(): string[] {
    return this.missingConfigVars;
  }

  buildAuthorizationUrl(state: string): string {
    return `https://www.pinterest.com/fake-oauth?state=${state}`;
  }

  async exchangeCodeForToken(_code: string): Promise<PinterestTokenSet> {
    if (this.exchangeResult instanceof ConnectorError) throw this.exchangeResult;
    return this.exchangeResult;
  }

  async refreshAccessToken(_refreshToken: string): Promise<PinterestTokenSet> {
    if (this.refreshResult instanceof ConnectorError) throw this.refreshResult;
    return this.refreshResult;
  }

  async fetchIdentity(_accessToken: string): Promise<VerifiedIdentity> {
    if (this.identityResult instanceof ConnectorError) throw this.identityResult;
    return this.identityResult;
  }

  async fetchRecentPins(_accessToken: string, _limit: number): Promise<RecentContentItem[]> {
    this.fetchRecentPinsCallCount += 1;
    if (this.recentPins instanceof ConnectorError) throw this.recentPins;
    return this.recentPins;
  }

  async fetchPinAnalytics(_accessToken: string, pinId: string): Promise<MetricsFetchOutcome> {
    return this.pinAnalyticsOutcomeFor(pinId);
  }
}
