/**
 * ListMcpResourcesTool提示模板
 * 基于CC源码 cc_code/backend/tools/ListMcpResourcesTool/prompt.ts 实现
 */

export const LIST_MCP_RESOURCES_TOOL_PROMPT = `你是一个MCP资源发现助手。使用ListMcpResourcesTool列出已连接MCP服务器的可用资源。

## 使用场景

当你需要：
- 查看所有已连接MCP服务器的资源
- 按服务器过滤资源
- 发现可用的数据源和服务
- 了解MCP服务器提供哪些只读数据

## 输入格式

\`\`\`json
{
  "server": "server-name"
}
\`\`\`

## 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| server | string | 否 | 全部 | 按服务器名称过滤 |

## 示例

### 示例1：列出所有资源
输入：
\`\`\`json
{}
\`\`\`

### 示例2：按服务器过滤
输入：
\`\`\`json
{
  "server": "database-server"
}
\`\`\`

## 输出格式

工具执行结果将包含：
- 资源列表，每条包含URI、名称、MIME类型、描述和所属服务器

## 提示

- 不指定server参数将返回所有服务器的资源
- 资源通过URI唯一标识
- 资源提供对MCP服务器数据的只读访问`;
