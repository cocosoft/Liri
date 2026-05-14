# 配置指南

## 配置层级

PY_APP 的配置按优先级从高到低排列：

1. **环境变量** - 运行时注入，优先级最高
2. **配置文件** - `config/governance.json`
3. **默认值** - 代码中的默认配置

## 环境变量

| 变量 | 说明 | 必需 |
|------|------|------|
| `AI_PROVIDER` | AI 提供商 | 是 |
| `AI_API_KEY` | API 密钥 | 是 |
| `AI_MODEL` | 模型名称 | 否 |
| `LOG_LEVEL` | 日志级别 | 否 |
| `PORT` | 服务端口 | 否 |

## 配置文件

`config/governance.json` 包含完整的系统配置：

```json
{
  "permissions": {
    "file_read": {
      "allowed": true,
      "paths": ["./src", "./config", "./docs"]
    },
    "file_write": {
      "allowed": true,
      "paths": ["./src", "./config"]
    },
    "bash_exec": {
      "allowed": true,
      "commands": ["node", "bun", "npm", "git", "npx"],
      "forbiddenCommands": ["rm -rf /*", "del /f /s"]
    }
  },
  "rateLimit": {
    "requestsPerMinute": 60,
    "tokensPerMinute": 100000
  }
}
```

## 运行时配置

```bash
# 查看当前配置
/config show

# 查看特定配置项
/config get AI_MODEL

# 修改配置（临时）
/config set LOG_LEVEL debug

# 重置配置为默认值
/config reset LOG_LEVEL
```
