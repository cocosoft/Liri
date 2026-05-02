/**
 * OAuth提供者适配器接口
 * 统一不同OAuth提供者的实现
 * 
 * 设计原则：
 * - 接口隔离：定义最小必要接口
 * - 依赖倒置：依赖抽象而非具体实现
 * - 开闭原则：对扩展开放，对修改关闭
 */

import type { OAuthTokenData, OAuthAuthResult } from './OAuthTypes';

/**
 * OAuth Token类型（简化版，用于统一接口）
 */
export type OAuthToken = OAuthAuthResult;

/**
 * 用户信息
 */
export interface UserInfo {
  id: string;
  name?: string;
  email?: string;
  [key: string]: unknown;
}

/**
 * OAuth提供者配置
 */
export interface OAuthProviderConfig {
  /** 授权端点URL */
  authorizeUrl: string;
  /** Token端点URL */
  tokenUrl: string;
  /** 用户信息端点URL（可选） */
  profileUrl?: string;
  /** 客户端ID */
  clientId: string;
  /** 客户端密钥（可选） */
  clientSecret?: string;
  /** 重定向URI */
  redirectUri: string;
  /** 默认权限范围 */
  scopes: string[];
}

/**
 * 授权选项
 */
export interface AuthorizeOptions {
  /** 授权码 */
  code: string;
  /** PKCE验证器 */
  codeVerifier: string;
  /** 重定向URI（可选，覆盖配置） */
  redirectUri?: string;
}

/**
 * OAuth提供者接口
 * 所有OAuth提供者必须实现此接口
 */
export interface OAuthProvider {
  /** 提供者唯一标识 */
  id: string;
  /** 提供者显示名称 */
  name: string;
  /** 提供者配置 */
  config: OAuthProviderConfig;

  /**
   * 执行授权流程
   * @param options 授权选项
   * @returns Token对象
   */
  authorize(options: AuthorizeOptions): Promise<OAuthToken>;

  /**
   * 刷新Token
   * @param refreshToken 刷新Token
   * @returns 新的Token对象
   */
  refreshToken(refreshToken: string): Promise<OAuthToken>;

  /**
   * 撤销Token
   */
  revokeToken(): Promise<void>;

  /**
   * 获取用户信息
   * @param accessToken 访问Token
   * @returns 用户信息
   */
  getUserInfo(accessToken: string): Promise<UserInfo>;
}
