# 配置详解

## 配置文件

### .env 文件

主要环境变量配置文件：

```ini
# AI 模型配置
AI_PROVIDER=openai
AI_API_KEY=
AI_MODEL=gpt-4
AI_BASE_URL=
AI_MAX_TOKENS=4096
AI_TEMPERATURE=0.7

# 日志配置
LOG_LEVEL=info
LOG_FILE=logs/app.log
LOG_MAX_SIZE=10MB
LOG_MAX_FILES=7

# 服务配置
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# 缓存配置
CACHE_ENABLED=true
CACHE_MAX_SIZE=100MB
CACHE_TTL=3600

# 会话配置
SESSION_TIMEOUT=1800000
SESSION_MAX_MESSAGES=1000
```

### governance.json

治理策略配置文件：

```json
{
  "permissions": {
    "file_read": { "allowed": true, "paths": ["./src", "./config"] },
    "file_write": { "allowed": true, "paths": ["./src", "./config"] },
    "bash_exec": { "allowed": true, "commands": ["node", "bun", "npm"] }
  },
  "rateLimit": {
    "requestsPerMinute": 60,
    "tokensPerMinute": 100000
  },
  "audit": {
    "enabled": true,
    "logPath": "logs/audit.log"
  }
}
```

## 配置优先级

1. 环境变量（最高）
2. `config/governance.json`
3. 默认值（最低）

## 运行时配置

使用 `/config` 命令查看和修改运行时配置：

```bash
# 查看所有配置
/config show

# 修改配置
/config set LOG_LEVEL debug

# 重置配置
/config reset LOG_LEVEL
```
