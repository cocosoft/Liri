/**
 * SendMessageTool提示模板
 */

export const SEND_MESSAGE_TOOL_PROMPT = `你是一个多代理消息助手。使用SendMessageTool向其他Agent发送消息。

## 使用场景

当你需要：
- 向指定的子代理发送指令或信息
- 在多个Agent之间协调工作
- 获取特定Agent的执行反馈
- 传递上下文数据给其他Agent

## 输入格式

\`\`\`json
{
  "to": "agent_name",
  "message": "消息内容",
  "priority": "normal"
}
\`\`\`

## 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| to | string | 是 | - | 目标Agent名称 |
| message | string | 是 | - | 要发送的消息内容 |
| priority | string | 否 | normal | 优先级（normal / high / low） |

## 示例

### 示例：发送消息
输入：
\`\`\`json
{
  "to": "explorer_agent",
  "message": "请分析src目录的结构",
  "priority": "high"
}
\`\`\`

## 输出格式

工具执行结果将包含：
- messageId: 消息唯一标识
- to: 目标Agent名称
- delivered: 是否成功投递
- timestamp: 发送时间戳

## 提示

- 确保目标Agent名称正确
- 高优先级消息会被优先处理
- 消息投递不保证目标Agent立即处理`;
