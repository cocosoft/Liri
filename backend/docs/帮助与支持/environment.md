# 环境变量参考

## 必需配置

| 变量 | 说明 | 示例 |
|------|------|------|
| `AI_PROVIDER` | AI 服务提供商 | `openai` |
| `AI_API_KEY` | API 密钥 | `sk-xxx` |

## AI 配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AI_MODEL` | 模型名称 | `gpt-4` |
| `AI_BASE_URL` | API 基础 URL | - |
| `AI_MAX_TOKENS` | 最大 Token 数 | `4096` |
| `AI_TEMPERATURE` | 温度参数 | `0.7` |

## 服务配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `HOST` | 监听地址 | `0.0.0.0` |
| `NODE_ENV` | 运行环境 | `development` |

## 日志配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LOG_LEVEL` | 日志级别 | `info` |
| `LOG_FILE` | 日志文件路径 | `logs/app.log` |
| `LOG_MAX_SIZE` | 日志文件大小限制 | `10MB` |

## 缓存配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CACHE_ENABLED` | 是否启用缓存 | `true` |
| `CACHE_MAX_SIZE` | 最大缓存大小 | `100MB` |
| `CACHE_TTL` | 缓存过期时间(秒) | `3600` |

## 会话配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SESSION_TIMEOUT` | 会话超时时间(ms) | `1800000` |
| `SESSION_MAX_MESSAGES` | 最大消息数 | `1000` |
