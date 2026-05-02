/**
 * BriefTool提示模板
 * 基于CC源码 cc_code/backend/tools/BriefTool/prompt.ts 实现
 */

export const BRIEF_TOOL_PROMPT = `你是一个会话摘要助手。使用BriefTool生成当前会话的摘要。

## 使用场景

当你需要：
- 快速回顾当前会话的讨论内容
- 提取会话中的关键决策和结论
- 生成待办事项列表
- 总结长时间对话的核心要点

## 输入格式

\`\`\`json
{
  "sessionId": "current",
  "summaryType": "concise",
  "maxLength": 1000,
  "messageCount": 20
}
\`\`\`

## 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| sessionId | string | 否 | 当前会话 | 要摘要的会话ID |
| summaryType | string | 否 | concise | 摘要类型（concise / detailed / actionable） |
| maxLength | number | 否 | 1000 | 摘要最大长度 |
| messageCount | number | 否 | 20 | 参考的最近消息数量 |

## 示例

### 示例1：生成简洁摘要
输入：
\`\`\`json
{
  "summaryType": "concise",
  "maxLength": 500
}
\`\`\`

### 示例2：生成行动摘要
输入：
\`\`\`json
{
  "summaryType": "actionable",
  "messageCount": 50
}
\`\`\`

## 输出格式

工具执行结果将包含：
- 根据指定类型生成的会话摘要内容
- 关键决策点（如适用）
- 待办事项列表（actionable类型）

## 提示

- concise类型适合快速回顾
- detailed类型包含更多上下文细节
- actionable类型重点提取需要执行的任务`;
