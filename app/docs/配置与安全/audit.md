# 审计日志

## 概述

审计日志记录所有敏感操作，包括文件操作、命令执行和管理操作。

## 记录的操���

| 操作类型 | 记录内容 |
|---------|---------|
| 文件读取 | 文件路径、操作者、时间 |
| 文件写入 | 文件路径、操作者、大小 |
| 命令执行 | 命令内容、操作者、结果 |
| 网络请求 | URL、方法、操作者 |
| 配置修改 | 配置项、旧值、新值 |
| 权限变更 | 变更内容、操作者 |

## 配置

```json
{
  "audit": {
    "enabled": true,
    "logPath": "logs/audit.log",
    "retention": "90d",
    "maxSize": "1GB",
    "format": "json"
  }
}
```

## 查看审计日志

```bash
# 查看最近的操作
/audit recent

# 搜索审计记录
/audit search "file_write"

# 导出审计日志
/audit export
```

## 日志格式

```json
{
  "timestamp": "2025-01-15T10:30:00Z",
  "type": "file_write",
  "user": "admin",
  "resource": "./src/index.ts",
  "action": "modify",
  "result": "success",
  "details": {
    "size": 1024,
    "lines_added": 10
  }
}
```

## 合规性

审计日志满足以下合规要求：

- 记录不可篡改
- 日志保留策略可配置
- 支持日志导出
- 支持日志轮转
