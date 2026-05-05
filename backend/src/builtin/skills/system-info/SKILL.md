---
name: system-info
description: 显示系统信息
version: 1.0.0
user-invocable: true
when-to-use: 当你需要了解当前系统信息时
---

显示当前系统信息：

**操作系统**: {{os}}
**Node.js版本**: {{nodeVersion}}
**当前目录**: {{cwd}}
**CPU核心数**: {{cpuCount}}

```!
echo "系统信息已显示"
```