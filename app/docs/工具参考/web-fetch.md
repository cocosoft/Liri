# web_fetch - 网页抓取工具

## 描述

从指定的 URL 抓取网页内容，支持 HTML 到 Markdown 的转换。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `url` | string | 是 | 要抓取的网页 URL |
| `max_length` | number | 否 | 最大内容长度 |

## 使用示例

```javascript
// 抓取网页
web_fetch({ url: "https://example.com" })

// 限制内容长度
web_fetch({ url: "https://example.com/article", max_length: 5000 })
```

## 功能特性

- HTML 自动转换为 Markdown
- 支持 JavaScript 渲染页面
- 请求超时保护
- 内容长度限制

## 安全特性

- SSRF 防护：禁止访问内网地址
- 预批准机制：访问新域名需确认
- 内容过滤：过滤恶意内容

## 返回值

返回转换后的 Markdown 文本内容。

## 注意事项

- 遵守 robots.txt 规则
- 频率限制：每分钟最多 30 次请求
- 大页面会被截断（默认最大 100KB）
