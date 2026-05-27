# Auth - 认证授权

## 概述

认证授权模块提供用户认证、OAuth 集成、API Key 认证和工具级别的权限管理能力，由 `core/auth/`、`oauth/` 和 `permission/` 三个子系统共同实现。

## 认证方式

### OAuth 认证

```typescript
import { OAuthClient } from "./oauth/services/OAuthClient.js";

const client = new OAuthClient({
  provider: "github",
  clientId: process.env.GITHUB_CLIENT_ID,
  clientSecret: process.env.GITHUB_CLIENT_SECRET,
  redirectUri: "http://localhost:3000/auth/callback"
});

// 获取认证 URL
const authUrl = client.getAuthorizationUrl({
  state: crypto.randomUUID(),
  scopes: ["read:user", "repo"]
});

// 处理回调
const token = await client.handleCallback(code);
```

### API Key 认证

```typescript
import { ApiKeyAuthenticator } from "./enterprise/auth/AuthChain.js";

const auth = new ApiKeyAuthenticator({
  keys: [/* API Key 列表 */]
});

// 验证请求
const isValid = auth.authenticate(apiKey);
```

## 权限控制

```typescript
import { PermissionManager } from "./permission/PermissionManager.js";

const permission = new PermissionManager();

// 检查工具权限
const decision = await permission.checkPermission("file_write", {
  filePath: "/data/report.pdf"
});

if (decision.allowed) {
  // 执行操作
} else {
  console.log(`权限拒绝: ${decision.reason}`);
}
```

## OAuth 提供者

| 提供者 | 说明 |
|--------|------|
| GitHub | 代码仓库和用户信息 |
| Google | Google API 集成 |
| Discord | 消息渠道集成 |
| 自定义 | 通过 oauth/types/OAuthProvider.ts 扩展 |

## 信任设备管理

```typescript
import { TrustedDeviceManager } from "./core/auth/trusted-device.js";

const trusted = new TrustedDeviceManager();
await trusted.registerDevice("device-id", {
  name: "我的笔记本",
  expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
});
```

## 安全建议

- 使用 HTTPS 传输
- 定期轮换 API Key
- 实施最小权限原则
- 启用设备信任管理
