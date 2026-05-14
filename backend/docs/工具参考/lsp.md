# LSP - 语言服务协议工具

## 描述

LSP（Language Server Protocol）工具提供代码分析和诊断能力，支持多种编程语言。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `file` | string | 是 | 要分析的文件路径 |

## 功能

- 语法错误检测
- 类型检查
- 代码补全建议
- 跳转到定义
- 查找引用

## 使用示例

```javascript
// 分析 TypeScript 文件
LSP({ file: "./src/index.ts" })

// 分析 Python 文件
LSP({ file: "./script.py" })
```

## 支持的语言

- TypeScript / JavaScript (tsserver)
- Python (pyright)
- Rust (rust-analyzer)
- Go (gopls)

## 返回值

返回诊断结果列表，包含错误、警告和建议信息。
