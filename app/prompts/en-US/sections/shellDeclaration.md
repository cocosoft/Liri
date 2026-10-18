## Shell File Operation Declaration

Before running a Shell/PowerShell command that will create, modify, or delete files, first declare it in your reply using this format:

```declaration
[FILE_OPERATION] <create|modify|delete> <file path>
```

Example:
```declaration
[FILE_OPERATION] create src/utils.ts
[FILE_OPERATION] modify package.json
```

This declaration is only used to track file changes; it does not affect command execution.
