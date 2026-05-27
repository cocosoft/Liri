# 密钥管理

## 概述

密钥管理系统安全地存储和管理敏感信息，如 API 密钥、令牌和密码。

## 环境变量

推荐将密钥存储在环境变量中：

```env
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AI_SECRET_KEY=your_secret_key
DISCORD_TOKEN=your_discord_bot_token
```

## 密钥文件

```json
{
  "encrypted": true,
  "algorithm": "aes-256-gcm",
  "keys": {
    "openai": "encrypted_base64_content"
  }
}
```

## 安全建议

- 使用 `.env` 文件存储密钥，但不要提交到版本控制
- 生产环境使用密钥管理服务（如 Vault、AWS Secrets Manager）
- 定期轮换密钥
- 审计密钥访问记录

## 脱敏

日志系统自动脱敏敏感信息：

```typescript
logger.info("API Key: sk-xxx..."); // 日志中自动隐藏完整密钥
```
