# PDF - PDF 处理工具

## 描述

处理 PDF 文件，支持读取、提取文本和元数据。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `file` | string | 是 | PDF 文件路径 |
| `operation` | string | 是 | 操作类型 |

## 操作类型

| 操作 | 说明 |
|------|------|
| `read` | 读取 PDF 文本内容 |
| `metadata` | 提取 PDF 元数据 |
| `pages` | 获取页数信息 |

## 使用示例

```javascript
// 读取 PDF 内容
PDF({
  file: "./document.pdf",
  operation: "read"
})

// 获取元数据
PDF({
  file: "./document.pdf",
  operation: "metadata"
})
```

## 返回值

返回提取的文本内容或元数据信息。
