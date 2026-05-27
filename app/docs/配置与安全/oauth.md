# OAuth 认证

## 概述

PY_APP 支持 OAuth 2.0 认证流程，提供安全的用户身份验证。

## 支持的提供者

| 提供者 | 配置字段 |
|--------|---------|
| GitHub | `clientId`, `clientSecret` |
| Google | `clientId`, `clientSecret` |
| Discord | `clientId`, `clientSecret` |
| 自定义 | `authorizationUrl`, `tokenUrl`, `clientId` |

## 配置

```env
OAUTH_GITHUB_CLIENT_ID=your_client_id
OAUTH_GITHUB_CLIENT_SECRET=your_client_secret
OAUTH_GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback
```

## 认证流程

1. 用户点击登录链接
2. 重定向到 OAuth 提供者
3. 用户授权应用
4. 回调到 PY_APP
5. 获取访问令牌
6. 获取用户信息
7. 创建/更新用户会话

## 令牌管理

```typescript
// 令牌存储
const tokens = {
  accessToken: "xxx",
  refreshToken: "yyy",
  expiresAt: Date.now() + 3600000
};

// 令牌自动刷新
oauth.onTokenExpired(async (refreshToken) => {
  return await oauth.refreshAccessToken(refreshToken);
});
```

## 安全建议

- 始终使用 HTTPS
- 设置合理的令牌过期时间
- 实施 CSRF 保护
- 验证回调状态参数
