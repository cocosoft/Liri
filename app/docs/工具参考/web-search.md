# web_search - 网络搜索工具

## 描述

通过网络搜索引擎搜索信息，支持多个搜索引擎提供商。

## 输入参数

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索关键词 |

## 使用示例

```javascript
// 基本搜索
web_search({ query: "TypeScript 教程" })

// 技术搜索
web_search({ query: "Node.js 性能优化 best practices" })
```

## 支持的搜索引擎

| 引擎 | 特点 |
|------|------|
| DuckDuckGo | 默认引擎，无需 API Key |
| Google | 需要 API Key，结果更精确 |
| Bing | 需要 API Key |
| SearXNG | 自托管搜索引擎 |

## 返回值

返回搜索结果列表，包含标题、摘要和链接。

## 注意事项

- 搜索结果的时效性取决于所使用的搜索引擎
- 私有信息可能不会出现在搜索结果中
- 每种搜索引擎有不同的频率限制
