# CodeExecution - 代码执行工具

## 描述

在沙箱环境中执行代码，支持多种编程语言。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `language` | string | 是 | 编程语言 |
| `code` | string | 是 | 要执行的代码 |
| `timeout` | number | 否 | 超时时间(ms) |

## 支持的语言

- Python
- JavaScript / TypeScript
- Rust
- Go
- Java
- C / C++

## 使用示例

```javascript
// 执行 Python 代码
code_execution({
  language: "python",
  code: "print('Hello, World!')"
})

// 执行 JavaScript
code_execution({
  language: "javascript",
  code: "console.log(1 + 1)"
})
```

## 安全限制

- 代码在沙箱中执行
- 禁止文件系统访问
- 禁止网络请求
- 内存和 CPU 使用限制
- 执行超时限制

## 返回值

返回代码执行的标准输出和标准错误。
