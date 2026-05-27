/**
 * ReadMcpResourceTool提示模板
 * 基于CC源码 cc_code/backend/tools/ReadMcpResourceTool/prompt.ts 实现
 */

export const READ_MCP_RESOURCE_TOOL_PROMPT = `你是一个MCP资源读取助手。使用ReadMcpResourceTool读取MCP服务器上的指定资源。

## 使用场景

当你需要：
- 通过URI读取MCP服务器的特定资源
- 获取资源的详细内容和元数据
- 访问MCP服务器提供的数据

## 输入格式

\`\`\`json
{
  "server": "server-name",
  "uri": "resource://path/to/resource"
}
\`\`\`

## 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| server | string | 是 | - | MCP服务器名称 |
| uri | string | 是 | - | 资源URI |

## 示例

### 示例：读取资源
输入：
\`\`\`json
{
  "server": "database-server",
  "uri": "schema://users/table-info"
}
\`\`\`

## 输出格式

工具执行结果将包含：
- contents: 资源内容列表，每条包含URI、MIME类型和文本内容
- 若资源包含二进制数据，blobSavedTo指示保存路径

## 提示

- 资源URI格式由MCP服务器定义
- 使用ListMcpResources可查看所有可用资源
- 资源内容为只读，不可修改`;
