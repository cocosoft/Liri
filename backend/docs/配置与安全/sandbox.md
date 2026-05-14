# 沙箱安全

## 概述

沙箱机制为代码执行和命令运行提供隔离的安全环境。

## 沙箱策略

### 文件系统隔离

- 工具只能访问允许的目录
- 操作系统关键路径被保护
- 临时文件自动清理

### 网络隔离

- 仅允许白名单内的网络请求
- 内网地址禁止访问（SSRF 防护）
- DNS 重绑定保护

### 进程隔离

- 命令执行在受限环境中运行
- CPU 和内存使用限制
- 执行超时自动终止

## 配置

```json
{
  "sandbox": {
    "enabled": true,
    "allowedPaths": ["./src", "./config", "./data"],
    "forbiddenPaths": ["C:\\Windows", "/etc", "/root"],
    "networkAccess": {
      "allowed": true,
      "allowedDomains": ["*.openai.com", "*.google.com"],
      "blockedIPs": ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
    },
    "execution": {
      "maxMemory": "512MB",
      "maxCPU": "50%",
      "timeout": 30000
    }
  }
}
```

## 安全边界

沙箱确保 Agent 的操作不会影响宿主系统的安全性和稳定性。
