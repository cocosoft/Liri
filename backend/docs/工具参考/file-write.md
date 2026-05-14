# file_write - 文件写入工具

## 描述

将内容写入指定的文件。如果文件不存在则创建，如果存在则覆盖。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `file_path` | string | 是 | 要写入的文件路径 |
| `content` | string | 是 | 要写入的内容 |

## 使用示例

```javascript
// 写入文本文件
file_write({
  file_path: "./output.txt",
  content: "Hello, PY_APP!"
})

// 写入 JSON 配置
file_write({
  file_path: "./config.json",
  content: JSON.stringify({ name: "PY_APP" }, null, 2)
})
```

## 安全限制

- 只能写入允许的目录（由治理策略配置）
- 不允许覆盖系统关键文件
- 文件大小受配额限制

## 注意事项

- 写入操作不可撤销，请确认文件路径正确
- 建议先使用 file_read 确认文件内容
- 写入二进制内容时需提供 Base64 编码
