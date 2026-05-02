# OAuth认证模块

## 概述

OAuth认证模块为PY_APP提供完整的OAuth 2.0认证支持，包括：

- **OAuth Discovery** (RFC 8414) - 自动发现OAuth服务器元数据
- **Token管理** - 安全的Token存储、刷新和生命周期管理
- **PKCE支持** (RFC 7636) - 安全的授权码流程
- **动态客户端注册** (RFC 7591) - 自动注册OAuth客户端
- **加密存储** - AES-256-GCM加密Token持久化

## 安装

OAuth模块已集成到PY_APP项目中，无需额外安装。

## 快速开始

### 1. 基本使用

```typescript
import { OAuthDiscovery, OAuthClient, OAuthTokenManager } from '@modules/oauth';

// 创建OAuth配置
const config = {
  authorizeUrl: 'https://auth.example.com/oauth/authorize',
  tokenUrl: 'https://auth.example.com/oauth/token',
  profileUrl: 'https://auth.example.com/oauth/userinfo',
  clientId: 'your-client-id',
  scopes: ['openid', 'profile', 'email'],
};

// 创建OAuth客户端
const client = new OAuthClient(config);

// 生成授权URL
const authUrl = client.getAuthorizationUrl({
  state: 'random-state',
  codeChallenge: 'pkce-challenge',
});

// 打开浏览器进行授权
// ...

// 交换授权码获取Token
const tokens = await client.exchangeCodeForToken({
  code: 'authorization-code',
  codeVerifier: 'pkce-verifier',
});
```

### 2. 使用OAuth Discovery

```typescript
import { OAuthDiscovery } from '@modules/oauth';

const discovery = new OAuthDiscovery();

// 自动发现OAuth元数据
const result = await discovery.discoverMetadata('https://auth.example.com');

// 从元数据构建OAuth配置
const config = discovery.buildOAuthConfig(
  result.metadata,
  'your-client-id',
  ['openid', 'profile']
);
```

### 3. Token持久化

```typescript
import { createOAuthStorage } from '@modules/oauth';

const storage = createOAuthStorage('~/.pyapp/oauth/tokens');

// 保存Token
await storage.saveToken('server-key', {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: Date.now() + 3600000,
  serverKey: 'server-key',
  savedAt: Date.now(),
});

// 加载Token
const token = await storage.loadToken('server-key');

// 删除Token
await storage.deleteToken('server-key');
```

### 4. Token管理

```typescript
import { OAuthTokenManager } from '@modules/oauth';

const manager = new OAuthTokenManager({
  storage: createOAuthStorage(),
  client: new OAuthClient(config),
});

// 获取Token（自动刷新）
const token = await manager.getToken('server-key');

// 保存Token
await manager.saveToken('server-key', tokenData);

// 删除Token
await manager.deleteToken('server-key');
```

### 5. 动态客户端注册

```typescript
import { DynamicClientReg } from '@modules/oauth';

const clientReg = new DynamicClientReg({
  registrationEndpoint: 'https://auth.example.com/oauth/register',
});

// 注册客户端
const clientInfo = await clientReg.registerClient({
  redirectUris: ['https://myapp.dev/callback'],
  grantTypes: ['authorization_code', 'refresh_token'],
  responseTypes: ['code'],
  clientName: 'My App',
});

console.log('Client ID:', clientInfo.clientId);
console.log('Client Secret:', clientInfo.clientSecret);
```

## API参考

### OAuthDiscovery

OAuth Discovery服务，实现RFC 8414标准。

#### 构造函数

```typescript
new OAuthDiscovery(config?: OAuthDiscoveryConfig)
```

**配置选项**:
- `cacheEnabled`: 是否启用缓存（默认: true）
- `cacheDuration`: 缓存时长（默认: 24小时）
- `timeout`: 请求超时（默认: 10秒）
- `retries`: 重试次数（默认: 2）
- `fallbackUrls`: 备用发现URL

#### 方法

##### `discoverMetadata(authServerUrl: string): Promise<OAuthDiscoveryResult>`

发现OAuth服务器元数据。

##### `buildOAuthConfig(metadata: OAuthServerMetadata, clientId: string, scopes?: string[]): OAuthConfig`

从元数据构建OAuth配置。

##### `clearCache(serverUrl?: string): void`

清除缓存。

### OAuthClient

OAuth HTTP客户端，处理Token交换和用户信息获取。

#### 构造函数

```typescript
new OAuthClient(config: OAuthConfig)
```

#### 方法

##### `getAuthorizationUrl(params: AuthUrlParams): string`

生成授权URL。

##### `exchangeCodeForToken(params: CodeExchangeParams): Promise<OAuthTokens>`

交换授权码获取Token。

##### `refreshToken(params: RefreshParams): Promise<OAuthTokens>`

刷新访问Token。

##### `getUserInfo(accessToken: string): Promise<UserInfo>`

获取用户信息。

##### `revokeToken(params: RevokeParams): Promise<void>`

撤销Token。

### OAuthTokenManager

Token管理服务，提供Token的CRUD操作和自动刷新。

#### 构造函数

```typescript
new OAuthTokenManager(config: TokenManagerConfig)
```

#### 方法

##### `getToken(serverKey: string): Promise<StoredTokenData | null>`

获取Token，如果过期则自动刷新。

##### `saveToken(serverKey: string, tokenData: StoredTokenData): Promise<void>`

保存Token。

##### `deleteToken(serverKey: string): Promise<void>`

删除Token。

##### `listTokens(): Promise<string[]>`

列出所有已保存的Token。

##### `clearAllTokens(): Promise<void>`

清除所有Token。

### DynamicClientReg

动态客户端注册服务，实现RFC 7591标准。

#### 构造函数

```typescript
new DynamicClientReg(config: DynamicClientRegConfig)
```

#### 方法

##### `registerClient(metadata: ClientMetadata): Promise<ClientInfo>`

注册OAuth客户端。

##### `readClient(clientId: string, clientSecret: string): Promise<ClientInfo>`

读取客户端信息。

##### `updateClient(clientId: string, clientSecret: string, metadata: ClientMetadata): Promise<ClientInfo>`

更新客户端信息。

##### `deleteClient(clientId: string, clientSecret: string): Promise<void>`

删除客户端。

## 配置

### 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `OAUTH_ENCRYPTION_KEY` | Token加密密钥 | 自动生成 |
| `OAUTH_TOKEN_DIR` | Token存储目录 | `~/.pyapp/oauth/tokens` |
| `OAUTH_CACHE_ENABLED` | 是否启用Discovery缓存 | `true` |
| `OAUTH_CACHE_DURATION` | Discovery缓存时长（毫秒） | `86400000` (24小时) |
| `OAUTH_TIMEOUT` | OAuth请求超时（毫秒） | `10000` |
| `OAUTH_RETRIES` | OAuth请求重试次数 | `2` |

## 安全

### Token加密

- **算法**: AES-256-GCM
- **密钥派生**: PBKDF2（100000次迭代）
- **文件权限**: 0o600（仅所有者可读写）

### PKCE

- **算法**: S256
- **code_verifier**: 43-128字符随机字符串
- **code_challenge**: SHA256(code_verifier)的Base64URL编码

### State参数

- **长度**: 32字节随机字符串
- **超时**: 300秒
- **用途**: 防止CSRF攻击

## 测试

### 运行测试

```bash
# 运行所有OAuth测试
bun test backend/src/oauth/tests/

# 运行特定测试
bun test backend/src/oauth/tests/OAuthDiscovery.test.ts
```

### 测试覆盖

- OAuth Discovery单元测试
- OAuth Token Storage单元测试
- OAuth Client集成测试
- Dynamic Client Reg集成测试

## 相关RFC标准

- **RFC 6749**: The OAuth 2.0 Authorization Framework
- **RFC 6750**: The OAuth 2.0 Authorization Framework: Bearer Token Usage
- **RFC 7636**: Proof Key for Code Exchange by OAuth Public Clients (PKCE)
- **RFC 8414**: OAuth 2.0 Authorization Server Metadata
- **RFC 7591**: OAuth 2.0 Dynamic Client Registration Protocol
- **RFC 7592**: OAuth 2.0 Dynamic Client Registration Management Protocol

## 模块依赖

```
oauth
├── core (必需)
├── infrastructure (必需)
├── config (可选)
└── memory (可选)
```

## 文件结构

```
backend/src/oauth/
├── index.ts                    # 模块入口
├── types/                      # 类型定义
│   ├── index.ts
│   ├── OAuthTypes.ts           # 核心OAuth类型
│   ├── OAuthDiscoveryTypes.ts  # Discovery相关类型
│   └── OAuthStorageTypes.ts    # 存储相关类型
├── services/                   # 服务层
│   ├── index.ts
│   ├── OAuthDiscovery.ts       # OAuth元数据发现服务
│   ├── OAuthTokenManager.ts    # Token管理服务
│   ├── OAuthClient.ts          # OAuth HTTP客户端
│   └── DynamicClientReg.ts     # 动态客户端注册服务
├── utils/                      # 工具函数
│   ├── index.ts
│   ├── OAuthCrypto.ts          # PKCE加密工具
│   ├── OAuthStorage.ts         # Token加密存储
│   └── OAuthConfig.ts          # OAuth配置管理
└── tests/                      # 测试文件
    ├── OAuthDiscovery.test.ts
    ├── OAuthStorage.test.ts
    ├── OAuthClient.test.ts
    └── DynamicClientReg.test.ts
```

## 许可证

MIT
