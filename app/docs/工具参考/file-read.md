# file_read - 文件读取工具

## 描述

读取指定文件的内容，支持文本文件和图片文件。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `file_path` | string | 是 | 要读取的文件路径 |

## 使用示例

```javascript
// 读取文本文件
file_read({ file_path: "./src/index.ts" })

// 读取配置文件
file_read({ file_path: "./config.json" })

// 读取日志文件
file_read({ file_path: "./logs/app.log" })
```

## 支持的文件类型

- 文本文件: `.txt`, `.json`, `.ts`, `.js`, `.md`, `.html`, `.css`, `.yaml`, `.xml`
- 图片文件: `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp` (返回图片信息)

## 返回结果

返回文件的文本内容或图片信息（尺寸、格式等）。

## 限制

- 文件大小限制: 默认 10MB
- 二进制文件将以 Base64 格式返回
- 路径必须符合安全策略配置
- **路径语义（G3，2026-08-31）**：绝对路径直接使用；相对路径优先解析到会话工作目录（cwd，含 worktree 隔离目录），无 cwd 时回退 `~/.pyapp/output/`。
