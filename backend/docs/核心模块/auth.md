# Auth - 认证授权

## 概述

认证授权模块提供用户认证、权限管理和安全控制能力。

## 认证方式

### OAuth 认证

```typescript
import { OAuthServer } from "./security/oauth/index.js";

const oauth = new OAuthServer({
  providers: ["github", "google", "discord"]
});

// 开始认证流程
const authUrl = oauth.getAuthorizationUrl("github");

// 处理回调
const token = await oauth.handleCallback(code);
```

### API Key 认证

```typescript
import { APIKeyAuth } from "./security/APIKeyAuth.js";

const auth = new APIKeyAuth({
  keys: JSON.parse(await file_read({ path: "data/api-keys.json" }))
});

// 验证请求
const isValid = auth.validate(request.apiKey);
```

## 权限控制

```typescript
// 检查权限
const hasPermission = await auth.checkPermission(userId, "file:write");

// 角色管理
await auth.assignRole(userId, "admin");
await auth.revokeRole(userId, "editor");
```

## 令牌管理

```typescript
// 生成令牌
const token = await auth.generateToken({ userId: "123", role: "admin" });

// 验证令牌
const decoded = await auth.verifyToken(token);

// 撤销令牌
await auth.revokeToken(token);
```

## OAuth 提供者

| 提供者 | 配置 |
|--------|------|
| GitHub | `clientId`, `clientSecret` |
| Google | `clientId`, `clientSecret` |
| Discord | `clientId`, `clientSecret` |

## 安全建议

- 使用 HTTPS 传输
- 定期轮换 API Key
- 实施最小权限原则
