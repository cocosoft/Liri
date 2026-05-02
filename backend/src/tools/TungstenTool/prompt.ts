/**
 * TungstenTool提示模板
 * 基于CC源码 cc_code/backend/tools/TungstenTool/prompt.ts 实现
 */

export const TUNGSTEN_TOOL_PROMPT = `你是一个终端会话管理助手。使用TungstenTool管理交互式终端会话。

## 使用场景

当你需要：
- 创建新的终端会话
- 列出所有活跃的终端会话
- 切换或恢复终端会话
- 删除不再需要的会话
- 查看会话信息或历史输出

## 输入格式

\`\`\`json
{
  "action": "create",
  "session_name": "my-session"
}
\`\`\`

## 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| action | string | 是 | list | 操作类型（create / list / switch / delete / info / history） |
| session_name | string | 否 | - | 新会话名称（create时需要） |
| session_id | string | 否 | - | 会话ID（switch / delete / info时需要） |

## 示例

### 示例1：创建新会话
输入：
\`\`\`json
{
  "action": "create",
  "session_name": "dev-server"
}
\`\`\`

### 示例2：列出会话
输入：
\`\`\`json
{
  "action": "list"
}
\`\`\`

### 示例3：删除会话
输入：
\`\`\`json
{
  "action": "delete",
  "session_id": "sess_abc123"
}
\`\`\`

## 输出格式

工具执行结果将包含：
- create: 新会话的ID和名称
- list: 所有会话的列表及状态
- switch: 切换到目标会话的确认
- delete: 删除确认
- info: 会话详细信息
- history: 会话的历史输出

## 提示

- 会话名称应简短且有意义
- 不使用的会话应及时删除以释放资源
- 切换会话前确认当前工作已保存`;
