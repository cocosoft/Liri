# 权限系统

## 概述

权限系统控制用户和工具对系统资源的访问。

## 权限层级

```text
用户 → 角色 → 权限
         ↓
      策略(Policy)
```

## 内置角色

| 角色 | 说明 |
|------|------|
| `admin` | 管理员，完全访问 |
| `user` | 普通用户，基本访问 |
| `readonly` | 只读用户，仅允许读取操作 |

## 权限定义

```typescript
type Permission =
  | "file:read"
  | "file:write"
  | "bash:exec"
  | "network:fetch"
  | "network:search"
  | "admin:config";
```

## 策略配置

```json
{
  "permissions": {
    "file_read": {
      "allowed": true,
      "paths": ["./src", "./config"],
      "excludedPaths": ["./config/secrets.json"]
    },
    "bash_exec": {
      "allowed": true,
      "commands": ["node", "bun", "git"],
      "forbiddenCommands": ["rm", "del", "format"]
    }
  }
}
```

## 路径验证

- 所有文件操作都会验证路径是否在允许范围内
- 通过路径规约（path.resolve）防止路径遍历攻击
- 禁止操作系统关键路径
