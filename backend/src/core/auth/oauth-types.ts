/**
 * OAuth类型定义
 * 提供OAuth 2.0认证所需的类型定义
 */

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: string[];
  subscriptionType?: SubscriptionType | null;
  rateLimitTier?: RateLimitTier | null;
  profile?: OAuthProfileResponse;
  tokenAccount?: {
    uuid: string;
    emailAddress: string;
    organizationUuid?: string;
  };
}

export interface OAuthTokenExchangeResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  account?: {
    uuid: string;
    email_address: string;
  };
  organization?: {
    uuid: string;
  };
}

export interface OAuthProfileResponse {
  account: {
    uuid: string;
    email: string;
    display_name?: string;
    created_at?: string;
  };
  organization?: {
    uuid: string;
    name?: string;
    organization_type?: string;
    rate_limit_tier?: string;
    billing_type?: string;
    has_extra_usage_enabled?: boolean;
    subscription_created_at?: string;
  };
}

export type SubscriptionType = 'pro' | 'max' | 'team' | 'enterprise' | null;
export type RateLimitTier = string | null;
export type BillingType = string | null;

export interface OAuthConfig {
  authorizeUrl: string;
  tokenUrl: string;
  profileUrl: string;
  successUrl: string;
  manualRedirectUrl: string;
  clientId: string;
  scopes: string[];
}

export interface OAuthProfileInfo {
  subscriptionType: SubscriptionType;
  rateLimitTier: RateLimitTier;
  displayName?: string;
  hasExtraUsageEnabled: boolean | null;
  billingType: BillingType;
  accountCreatedAt?: string;
  subscriptionCreatedAt?: string;
  rawProfile?: OAuthProfileResponse;
}

export interface OAuthServiceOptions {
  loginWithPyApp?: boolean;
  inferenceOnly?: boolean;
  expiresIn?: number;
  orgUUID?: string;
  loginHint?: string;
  loginMethod?: string;
  skipBrowserOpen?: boolean;
}
