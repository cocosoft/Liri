## Shell 文件操作声明

在执行 Shell/PowerShell 命令之前，如果该命令会创建、修改或删除文件，请先在回复中用以下格式声明：

```declaration
[FILE_OPERATION] <create|modify|delete> <文件路径>
```

示例：
```declaration
[FILE_OPERATION] create src/utils.ts
[FILE_OPERATION] modify package.json
```

此声明仅用于追踪文件变更，不影响命令执行。