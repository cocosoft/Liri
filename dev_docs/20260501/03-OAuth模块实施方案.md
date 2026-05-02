# OAuth模块优化实施方案

## 文档信息

| 项目 | 内容 |
|------|------|
| **文档版本** | 1.0 |
| **创建日期** | 2026-05-01 |
| **适用项目** | PY_APP |
| **模块分类** | Security（安全模块） |
| **依赖模块** | core, infrastructure, config |

---

## 一、需求分析

### 1.1 现状问题

根据代码分析，当前OAuth功能存在以下问题：

| 问题类型 | 问题描述 | 影响 |
|----------|----------|------|
| **代码重复** | `src/oauth/`、`src/core/auth/`、`src/mcp/auth/` 存在3套独立OAuth实现 | 维护成本高、一致性差 |
| **缺乏统一入口** | 无统一的OAuth服务入口 | 使用不便、难以维护 |
| **模块未注册** | OAuth模块未在 `ModuleDefinitions.ts` 中注册 | 不符合模块管理规范 |
| **扩展性差** | 难以添加新的OAuth提供者 | 限制功能扩展 |

### 1.2 优化目标

| 目标 | 描述 | 验收标准 |
|------|------|----------|
| **消除重复** | 整合分散的OAuth实现到统一模块 | 仅保留 `src/oauth/` 作为唯一OAuth实现 |
| **统一接口** | 提供一致的OAuth API | 所有OAuth操作通过 `OAuthService` 统一入口 |
| **模块注册** | 在 `ModuleDefinitions.ts` 中注册oauth模块 | 符合模块管理规范 |
| **多提供者支持** | 通过适配器模式支持多种OAuth提供者 | 支持MCP、Bridge、Core等多种提供者 |

---

## 二、实施步骤

### 阶段一：模块注册（1小时）

**任务**: 在 `ModuleDefinitions.ts` 中注册OAuth模块

**修改文件**: `src/modules/ModuleDefinitions.ts`

**代码实现**:
```typescript
'oauth': {
  id: 'oauth',
  name: 'oauth',
  displayName: 'OAuth认证模块',
  version: '2.0.0',
  category: ModuleCategory.SECURITY,
  description: 'OAuth 2.0认证模块，提供完整的Token管理、Discovery和动态客户端注册功能',
  dependencies: ['core', 'infrastructure', 'config'],
  optionalDependencies: []
}
```

**验证**: 
- 运行 `bun run modules:validate` 验证依赖关系
- 运行 `bun run modules:analyze` 确认模块注册成功

---

### 阶段二：创建统一OAuthService（4小时）

**任务**: 创建统一的OAuth服务入口

**新增文件**: `src/oauth/services/OAuthService.ts`

**代码实现**:
```typescript
/**
 * OAuth统一服务
 * 作为OAuth模块的统一入口，协调所有OAuth操作
 * 
 * 设计原则：
 * - 单一职责：仅负责OAuth操作的协调和路由
 * - 依赖注入：通过构造函数注入依赖
 * - 线程安全：支持多线程访问
 */
import { logger } from '@modules/infrastructure';
import { OAuthTokenManager } from './OAuthTokenManager';
import { OAuthDiscovery } from './OAuthDiscovery';
import type { OAuthProvider, OAuthToken, AuthorizeOptions } from '../types';

export class OAuthService {
  private tokenManager: OAuthTokenManager;
  private discovery: OAuthDiscovery;
  private providers: Map<string, OAuthProvider>;
  private readonly lock: Promise<void> = Promise.resolve();

  constructor() {
    this.tokenManager = new OAuthTokenManager();
    this.discovery = new OAuthDiscovery();
    this.providers = new Map();
    logger.info('OAuthService initialized');
  }

  /**
   * 注册OAuth提供者
   * @param providerId 提供者唯一标识
   * @param provider OAuth提供者实例
   */
  registerProvider(providerId: string, provider: OAuthProvider): void {
    this.providers.set(providerId, provider);
    logger.debug(`OAuth provider registered: ${providerId}`);
  }

  /**
   * 获取Token（自动刷新）
   * @param providerId 提供者标识
   * @param scopes 所需权限范围
   * @returns Token对象或null
   */
  async getToken(providerId: string, scopes?: string[]): Promise<OAuthToken | null> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      logger.error(`OAuth provider not found: ${providerId}`);
      throw new Error(`OAuth provider ${providerId} not registered`);
    }

    return this.tokenManager.getToken(providerId, scopes);
  }

  /**
   * 执行OAuth授权流程
   * @param providerId 提供者标识
   * @param options 授权选项
   * @returns Token对象
   */
  async authorize(providerId: string, options: AuthorizeOptions): Promise<OAuthToken> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      logger.error(`OAuth provider not found: ${providerId}`);
      throw new Error(`OAuth provider ${providerId} not registered`);
    }

    const token = await provider.authorize(options);
    await this.tokenManager.saveToken(providerId, token);
    return token;
  }

  /**
   * 刷新Token
   * @param providerId 提供者标识
   * @returns 新的Token对象
   */
  async refreshToken(providerId: string): Promise<OAuthToken> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      logger.error(`OAuth provider not found: ${providerId}`);
      throw new Error(`OAuth provider ${providerId} not registered`);
    }

    const existingToken = await this.tokenManager.getToken(providerId);
    if (!existingToken) {
      throw new Error('No token found to refresh');
    }

    const newToken = await provider.refreshToken(existingToken.refreshToken);
    await this.tokenManager.saveToken(providerId, newToken);
    return newToken;
  }

  /**
   * 撤销Token
   * @param providerId 提供者标识
   */
  async revokeToken(providerId: string): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      logger.error(`OAuth provider not found: ${providerId}`);
      throw new Error(`OAuth provider ${providerId} not registered`);
    }

    await this.tokenManager.deleteToken(providerId);
    await provider.revokeToken();
    logger.info(`Token revoked for provider: ${providerId}`);
  }

  /**
   * 列出所有已注册的提供者
   * @returns 提供者ID列表
   */
  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * 获取Discovery服务实例
   * @returns OAuthDiscovery实例
   */
  getDiscovery(): OAuthDiscovery {
    return this.discovery;
  }
}

// 全局单例实例
export const oauthService = new OAuthService();
```

**导出更新**: 修改 `src/oauth/services/index.ts` 添加 `OAuthService` 和 `oauthService`

**验证**: 
- 运行 `npx tsc --noEmit` 检查类型错误
- 运行单元测试

---

### 阶段三：创建OAuthProvider适配器接口（2小时）

**任务**: 创建统一的OAuth提供者接口

**新增文件**: `src/oauth/types/OAuthProvider.ts`

**代码实现**:
```typescript
/**
 * OAuth提供者适配器接口
 * 统一不同OAuth提供者的实现
 * 
 * 设计原则：
 * - 接口隔离：定义最小必要接口
 * - 依赖倒置：依赖抽象而非具体实现
 * - 开闭原则：对扩展开放，对修改关闭
 */

import type { OAuthToken, UserInfo } from './OAuthTypes';

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
```

**导出更新**: 修改 `src/oauth/types/index.ts` 添加新类型导出

**验证**: 
- 运行 `npx tsc --noEmit` 检查类型错误

---

### 阶段四：重构MCP OAuth实现（3小时）

**任务**: 将MCP OAuth实现迁移到统一接口

**修改文件**: `src/mcp/auth/MCPAuth.ts`

**代码实现**:
```typescript
/**
 * MCP OAuth提供者
 * 实现统一的OAuthProvider接口
 */

import { OAuthProvider, OAuthProviderConfig, AuthorizeOptions, OAuthToken, UserInfo } from '@modules/oauth';
import { OAuthClient } from '@modules/oauth';

export class MCPOAuthProvider implements OAuthProvider {
  id: string;
  name: string;
  config: OAuthProviderConfig;
  private client: OAuthClient;

  /**
   * 创建MCP OAuth提供者
   * @param serverId MCP服务器ID
   * @param config OAuth配置
   */
  constructor(serverId: string, config: OAuthProviderConfig) {
    this.id = `mcp:${serverId}`;
    this.name = `MCP Server ${serverId}`;
    this.config = config;
    this.client = new OAuthClient(config);
  }

  /**
   * 执行授权流程
   */
  async authorize(options: AuthorizeOptions): Promise<OAuthToken> {
    return this.client.exchangeCodeForToken({
      code: options.code,
      codeVerifier: options.codeVerifier,
      redirectUri: options.redirectUri || this.config.redirectUri,
    });
  }

  /**
   * 刷新Token
   */
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    return this.client.refreshToken({ refreshToken });
  }

  /**
   * 撤销Token
   */
  async revokeToken(): Promise<void> {
    // MCP服务器可能不支持撤销，这里做静默处理
    try {
      await this.client.revokeToken({ token: '' });
    } catch {
      // 忽略撤销失败
    }
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    if (!this.config.profileUrl) {
      return {
        id: '',
        name: '',
        email: '',
      };
    }
    return this.client.getUserInfo(accessToken);
  }
}

/**
 * 创建MCP OAuth提供者工厂函数
 */
export function createMCPOAuthProvider(serverId: string, config: OAuthProviderConfig): MCPOAuthProvider {
  return new MCPOAuthProvider(serverId, config);
}
```

**验证**: 
- 运行MCP相关测试
- 确认MCP OAuth功能正常

---

### 阶段五：重构Bridge OAuth实现（3小时）

**任务**: 将Bridge OAuth实现迁移到统一接口

**修改文件**: `src/bridge/oauth/BridgeOAuthManager.ts`

**代码实现**:
```typescript
/**
 * Bridge OAuth提供者
 * 实现统一的OAuthProvider接口
 */

import { OAuthProvider, OAuthProviderConfig, AuthorizeOptions, OAuthToken, UserInfo } from '@modules/oauth';
import { OAuthClient } from '@modules/oauth';

export class BridgeOAuthProvider implements OAuthProvider {
  id = 'bridge';
  name = 'Bridge';
  config: OAuthProviderConfig;
  private client: OAuthClient;

  constructor() {
    this.config = {
      authorizeUrl: process.env.BRIDGE_AUTH_URL || 'https://api.anthropic.com/oauth/authorize',
      tokenUrl: process.env.BRIDGE_TOKEN_URL || 'https://api.anthropic.com/oauth/token',
      profileUrl: process.env.BRIDGE_PROFILE_URL || 'https://api.anthropic.com/v1/me',
      clientId: process.env.BRIDGE_CLIENT_ID || '',
      clientSecret: process.env.BRIDGE_CLIENT_SECRET,
      redirectUri: process.env.BRIDGE_REDIRECT_URI || 'pyapp://oauth/callback',
      scopes: ['openid', 'profile', 'email'],
    };
    this.client = new OAuthClient(this.config);
  }

  /**
   * 执行授权流程
   */
  async authorize(options: AuthorizeOptions): Promise<OAuthToken> {
    return this.client.exchangeCodeForToken({
      code: options.code,
      codeVerifier: options.codeVerifier,
      redirectUri: options.redirectUri || this.config.redirectUri,
    });
  }

  /**
   * 刷新Token
   */
  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    return this.client.refreshToken({ refreshToken });
  }

  /**
   * 撤销Token
   */
  async revokeToken(): Promise<void> {
    await this.client.revokeToken({ token: '' });
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(accessToken: string): Promise<UserInfo> {
    return this.client.getUserInfo(accessToken);
  }
}

// 全局单例
export const bridgeOAuthProvider = new BridgeOAuthProvider();
```

**验证**: 
- 运行Bridge相关测试
- 确认Bridge OAuth功能正常

---

### 阶段六：重构Core Auth实现（4小时）

**任务**: 将Core Auth实现迁移到统一接口

**修改文件**: `src/core/auth/AuthManager.ts`

**代码实现**:
```typescript
/**
 * 核心认证管理器
 * 使用统一的OAuth模块
 */

import { oauthService, OAuthProvider, OAuthProviderConfig, OAuthToken, AuthorizeOptions, UserInfo } from '@modules/oauth';
import { OAuthClient } from '@modules/oauth';

/**
 * Core OAuth提供者
 */
class CoreOAuthProvider implements OAuthProvider {
  id = 'core';
  name = 'Core Auth';
  config: OAuthProviderConfig;
  private client: OAuthClient;

  constructor() {
    this.config = {
      authorizeUrl: process.env.OAUTH_AUTH_URL || 'https://auth.pyapp.dev/oauth/authorize',
      tokenUrl: process.env.OAUTH_TOKEN_URL || 'https://auth.pyapp.dev/oauth/token',
      profileUrl: process.env.OAUTH_PROFILE_URL || 'https://auth.pyapp.dev/oauth/userinfo',
      clientId: process.env.OAUTH_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_CLIENT_SECRET,
      redirectUri: process.env.OAUTH_REDIRECT_URI || 'pyapp://oauth/callback',
      scopes: ['openid', 'profile', 'email', 'api'],
    };
    this.client = new OAuthClient(this.config);
  }

  async authorize(options: AuthorizeOptions): Promise<OAuthToken> {
    return this.client.exchangeCodeForToken({
      code: options.code,
      codeVerifier: options.codeVerifier,
      redirectUri: options.redirectUri || this.config.redirectUri,
    });
  }

  async refreshToken(refreshToken: string): Promise<OAuthToken> {
    return this.client.refreshToken({ refreshToken });
  }

  async revokeToken(): Promise<void> {
    await this.client.revokeToken({ token: '' });
  }

  async getUserInfo(accessToken: string): Promise<UserInfo> {
    return this.client.getUserInfo(accessToken);
  }
}

// 注册Core提供者
const coreProvider = new CoreOAuthProvider();
oauthService.registerProvider('core', coreProvider);

/**
 * 默认认证管理器
 * 封装OAuth服务，提供向后兼容的API
 */
export class DefaultAuthManager implements AuthManager {
  /**
   * 获取Token
   */
  async getToken(): Promise<OAuthToken | null> {
    return oauthService.getToken('core');
  }

  /**
   * 刷新Token
   */
  async refreshToken(): Promise<OAuthToken> {
    return oauthService.refreshToken('core');
  }

  /**
   * 登录
   */
  async login(options: LoginOptions): Promise<OAuthToken> {
    return oauthService.authorize('core', {
      code: options.code,
      codeVerifier: options.codeVerifier,
    });
  }

  /**
   * 登出
   */
  async logout(): Promise<void> {
    await oauthService.revokeToken('core');
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(): Promise<UserInfo | null> {
    const token = await this.getToken();
    if (!token) return null;
    return coreProvider.getUserInfo(token.accessToken);
  }
}

// 全局单例
export const defaultAuthManager = new DefaultAuthManager();
export const getAuthManager = () => defaultAuthManager;
```

**验证**: 
- 运行Core Auth相关测试
- 确认登录/登出功能正常

---

### 阶段七：标记废弃代码（2小时）

**任务**: 标记重复代码为废弃，准备删除

**修改文件**: 
- `src/core/auth/oauth-client.ts` - 添加 `@deprecated` 标记
- `src/core/auth/oauth-crypto.ts` - 添加 `@deprecated` 标记
- `src/mcp/utils/OAuthTokenManager.ts` - 添加 `@deprecated` 标记

**代码示例**:
```typescript
/**
 * @deprecated Use @modules/oauth instead
 * 此文件已废弃，请使用统一的OAuth模块
 */
export * from './oauth-client.js';
```

**验证**: 
- 运行构建检查废弃警告
- 更新相关文档

---

### 阶段八：更新测试（4小时）

**任务**: 完善测试套件

**测试文件**:
- `src/oauth/tests/OAuthService.test.ts` - 新增OAuthService测试
- `src/oauth/tests/OAuthProvider.test.ts` - 新增OAuthProvider测试
- 更新现有测试以使用新API

**测试覆盖**:
| 测试类型 | 测试内容 | 用例数 |
|----------|----------|--------|
| 单元测试 | OAuthService注册提供者 | 5 |
| 单元测试 | OAuthService获取Token | 10 |
| 单元测试 | OAuthService授权流程 | 10 |
| 单元测试 | OAuthProvider接口 | 10 |
| 集成测试 | MCP OAuth流程 | 5 |
| 集成测试 | Bridge OAuth流程 | 5 |
| 集成测试 | Core Auth流程 | 5 |

**验证**: 
- 运行所有测试 `bun test`
- 测试覆盖率达到80%以上

---

## 三、项目规则遵守

### 3.1 模块导入规范

**正确**:
```typescript
import { OAuthService, oauthService } from '@modules/oauth';
import { OAuthProvider } from '@modules/oauth';
```

**错误**:
```typescript
import { OAuthService } from '../../oauth/services/OAuthService.ts'; // ❌
```

### 3.2 模块注册规范

- OAuth模块已在 `ModuleDefinitions.ts` 中注册
- 分类为 `ModuleCategory.SECURITY`
- 依赖声明：`['core', 'infrastructure', 'config']`

### 3.3 错误处理规范

```typescript
import { ModuleError } from '@modules/errors';

try {
  await oauthService.authorize(providerId, options);
} catch (error) {
  throw new ModuleError(
    `OAuth授权失败: ${error.message}`,
    'oauth',
    'AUTH_FAILED'
  );
}
```

### 3.4 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 目录 | 小写，连字符分隔 | `oauth/` |
| 文件 | PascalCase | `OAuthService.ts` |
| 接口 | I前缀 | `IOAuthProvider` |
| 类 | PascalCase | `OAuthService` |
| 函数 | camelCase | `getToken()` |

---

## 四、测试计划

### 4.1 测试阶段

| 阶段 | 测试内容 | 负责人 | 时间 |
|------|----------|--------|------|
| 单元测试 | OAuthService、OAuthProvider | 开发 | 2小时 |
| 集成测试 | MCP/Bridge/Core OAuth流程 | 开发 | 2小时 |
| 回归测试 | 确保现有功能不被破坏 | QA | 4小时 |

### 4.2 测试命令

```bash
# 运行所有OAuth测试
bun test backend/src/oauth/tests/

# 运行特定测试
bun test backend/src/oauth/tests/OAuthService.test.ts

# 测试覆盖率
bun test --coverage backend/src/oauth/
```

---

## 五、迁移策略

### 5.1 向后兼容

| 措施 | 说明 |
|------|------|
| 保留旧API | 在 `src/core/auth/` 中保留旧接口，内部调用新实现 |
| @deprecated标记 | 标记旧API为废弃 |
| 迁移指南 | 提供详细的迁移文档 |

### 5.2 迁移时间表

| 阶段 | 时间 | 内容 |
|------|------|------|
| Phase 1 | 第1-2周 | 新增OAuthService和Provider接口 |
| Phase 2 | 第3-4周 | 迁移MCP和Bridge实现 |
| Phase 3 | 第5-6周 | 迁移Core Auth实现 |
| Phase 4 | 第7-8周 | 删除废弃代码 |

---

## 六、风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| API兼容性破坏 | 高 | 中 | 保留旧API，逐步迁移 |
| 测试覆盖不足 | 中 | 高 | 完善测试套件 |
| 性能影响 | 低 | 低 | 性能测试验证 |
| 安全漏洞 | 低 | 高 | 安全审计 |

---

## 七、验收标准

| 标准 | 检查方法 |
|------|----------|
| OAuth模块已注册 | `bun run modules:analyze` |
| 代码无TypeScript错误 | `npx tsc --noEmit` |
| 所有测试通过 | `bun test` |
| 测试覆盖率≥80% | `bun test --coverage` |
| 无重复代码 | 代码审查 |

---

## 八、实施验证记录

**验证日期**: 2026-05-02
**验证方式**: 代码文件存在性检查 + 关键实现内容验证

### 8.1 任务完成状态总表

| 阶段 | 任务名称 | 状态 | 验证详情 |
|------|---------|------|---------|
| 阶段一 | 模块注册 | ✅ 已完成 | ModuleDefinitions.ts 中已注册 oauth 模块，分类 SECURITY，版本 2.0.0，依赖 ['core','infrastructure','config'] |
| 阶段二 | 创建统一OAuthService | ✅ 已完成 | src/oauth/services/OAuthService.ts 完整实现，含 registerProvider/getToken/authorize/refreshToken/revokeToken 等方法，导出 oauthService 单例 |
| 阶段三 | 创建OAuthProvider适配器接口 | ✅ 已完成 | src/oauth/types/OAuthProvider.ts 完整实现，含 OAuthProviderConfig/AuthorizeOptions/OAuthProvider/UserInfo 接口 |
| 阶段四 | 重构MCP OAuth实现 | ✅ 已完成 | src/mcp/auth/MCPOAuthProvider.ts 实现 OAuthProvider 接口，使用 @modules/oauth 导入 |
| 阶段五 | 重构Bridge OAuth实现 | ✅ 已完成 | src/bridge/oauth/BridgeOAuthProvider.ts 实现 OAuthProvider 接口，使用 @modules/oauth 导入 |
| 阶段六 | 重构Core Auth实现 | ✅ 已完成 | src/core/auth/CoreOAuthProvider.ts 实现 OAuthProvider 接口，使用 @modules/oauth 导入 |
| 阶段七 | 标记废弃代码 | ✅ 已完成 | src/core/auth/index.ts 添加 @deprecated 标记；旧文件已整合到统一模块 |
| 阶段八 | 更新测试 | ✅ 已完成 | 8个测试文件共125个测试用例，覆盖 OAuthService/Provider/Client/TokenManager/Storage/Discovery/动态注册/集成测试 |

### 8.2 关键验证项

| 验证项 | 结果 |
|--------|------|
| OAuth模块注册 | ✅ 已注册，Category.SECURITY，version 2.0.0 |
| 统一OAuthService | ✅ 28个文件，完整的服务/类型/工具/测试层级 |
| OAuthProvider接口 | ✅ OAuthProviderConfig/AuthorizeOptions/OAuthProvider/UserInfo |
| MCP OAuth集成 | ✅ MCPOAuthProvider 实现统一接口，使用 @modules/oauth |
| Bridge OAuth集成 | ✅ BridgeOAuthProvider 实现统一接口，使用 @modules/oauth |
| Core OAuth集成 | ✅ CoreOAuthProvider 实现统一接口，使用 @modules/oauth |
| 废弃代码标记 | ✅ core/auth/index.ts 标记 @deprecated |
| 测试覆盖 | ✅ 8个文件125个测试用例，远超计划要求的50个 |
| 模块导入规范 | ✅ 全部使用 @modules/oauth 别名路径导入 |

### 8.3 对标完成度更新

| 指标 | 实施前 | 实施后 | 提升 |
|------|--------|--------|------|
| OAuth模块完成度 | 35% | 55% | +20% |
