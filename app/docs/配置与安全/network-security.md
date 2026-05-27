# 网络安全

## 概述

网络安全策略控制 Agent 的网络访问行为，防止恶意请求和数据泄露。

## 访问控制

### 域名白名单

允许访问的域名列表：

```json
{
  "network": {
    "allowedDomains": [
      "*.openai.com",
      "*.google.com",
      "api.github.com",
      "*.python.org"
    ],
    "blockedDomains": [
      "malware.example.com"
    ]
  }
}
```

### IP 黑名单

```json
{
  "network": {
    "blockedIPs": [
      "10.0.0.0/8",
      "172.16.0.0/12",
      "192.168.0.0/16",
      "127.0.0.0/8"
    ]
  }
}
```

## 请求限制

```json
{
  "rateLimit": {
    "requestsPerMinute": 60,
    "tokensPerMinute": 100000,
    "burstSize": 10
  }
}
```

## TLS/SSL

- 所有 API 请求使用 HTTPS
- 支持自定义 CA 证书
- 证书验证严格模式

## SSRF 防护

- 内网地址自动拦截
- DNS 重绑定检查
- IP 地址格式验证
- URL 协议限制（仅允许 http/https）
