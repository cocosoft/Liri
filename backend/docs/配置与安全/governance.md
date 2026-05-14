# 治理系统

## 概述

治理系统（Governance）提供安全策略管理和合规控制，确保 AI Agent 的操作在可控范围内执行。

## 核心组件

```typescript
import { Governance } from "./security/governance/Governance.js";

const governance = new Governance(config);

// 权限检查
const allowed = governance.checkPermission("file_write", {
  filePath: "./src/index.ts"
});

// 命令验证
const safe = governance.validateCommand("bun run build");
```

## 治理策略

治理策略定义在 `config/governance.json` 中：

```json
{
  "version": "1.0",
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
      "forbiddenPatterns": ["rm\\s+-rf", "del\\s+/[fFsS]"],
      "readonly": true
    }
  },
  "approval": {
    "required": true,
    "mode": "pre-approval",
    "bypassCommands": ["ls", "dir", "cat", "type"],
    "timeout": 30000
  },
  "rateLimit": {
    "requestsPerMinute": 60,
    "tokensPerMinute": 100000,
    "burstSize": 10
  },
  "audit": {
    "enabled": true,
    "logPath": "logs/audit.log",
    "retention": "90d"
  }
}
```

## 预批准模式

- **pre-approval**: 高危操作需要用户预先确认
- **auto-approve**: 自动批准低风险操作
- **manual**: 所有操作需要确认

## 审计日志

所有敏感操作都会记录到审计日志，包括：

- 操作类型
- 操作参数
- 操作时间
- 执行结果
- 用户确认状态

## 使用场景

- 限制文件操作的范围
- 控制命令执行的权限
- 管理网络访问策略
- 实施频率限制
- 记录所有敏感操作
