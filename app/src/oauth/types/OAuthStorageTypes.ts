/**
 * OAuth存储类型定义
 */

/**
 * Token存储数据结构
 */
export interface StoredTokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType?: string;
  scopes?: string[];
  serverKey: string;
  savedAt: number;
}

/**
 * Token存储接口
 */
export interface ITokenStorage {
  saveToken(serverKey: string, tokenData: StoredTokenData): Promise<void>;
  loadToken(serverKey: string): Promise<StoredTokenData | null>;
  deleteToken(serverKey: string): Promise<void>;
  listTokens(): Promise<string[]>;
  clearAllTokens(): Promise<void>;
}

/**
 * Discovery缓存存储接口
 */
export interface IDiscoveryCacheStorage {
  saveCache(serverKey: string, metadata: unknown): Promise<void>;
  loadCache(serverKey: string): Promise<unknown | null>;
  deleteCache(serverKey: string): Promise<void>;
  clearAllCache(): Promise<void>;
}
