/**
 * claudeApi 技能 - 提供 Claude API 使用指导
 * 对标 CC 的 claudeApi 技能
 */

import { Skill } from '../SkillManager.js';

const claudeApiSkill: Skill = {
  name: 'claudeApi',
  description: '提供 Claude API 使用指南，包括消息API、工具使用、流式响应等',
  version: '1.0.0',
  author: 'Liri',
  execute: async (args: any[]) => {
    const topic = args[0] || 'overview';

    const guides: Record<string, string> = {
      overview: `Claude API 使用指南

Claude API 提供以下核心功能：
1. 消息 API (Messages API) - 发送消息并获取回复
2. 流式响应 (Streaming) - 实时获取生成内容
3. 工具使用 (Tool Use) - 让 Claude 调用外部工具
4. 视觉能力 (Vision) - 分析和理解图片内容

使用示例:
  POST https://api.anthropic.com/v1/messages
  Headers:
    x-api-key: $ANTHROPIC_API_KEY
    anthropic-version: 2023-06-01
  Body:
    {
      "model": "claude-3-opus-20240229",
      "max_tokens": 1024,
      "messages": [{"role": "user", "content": "Hello, Claude!"}]
    }`,
      messages: `Messages API 详解

请求格式:
  {
    "model": "claude-3-opus-20240229",
    "max_tokens": 1024,
    "messages": [
      {"role": "user", "content": "Hello"},
      {"role": "assistant", "content": "Hi!"},
      {"role": "user", "content": "How are you?"}
    ],
    "system": "You are a helpful assistant."
  }

支持的消息角色:
  - user: 用户消息
  - assistant: 助手回复
  - system: 系统提示（可选）

注意：消息列表必须以 user 角色开始和结束`,
      tools: `Tool Use 功能

Claude 可以调用你定义的函数/工具：

  {
    "tools": [
      {
        "name": "get_weather",
        "description": "获取指定城市的天气",
        "input_schema": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    ],
    "tool_choice": {"type": "auto"}
  }

Claude 会返回 tool_use 类型的 content block，
你需要执行该调用并把结果通过 tool_result 返回。`,
      streaming: `流式响应 (Streaming)

使用 SSE (Server-Sent Events) 实现实时响应：

  POST https://api.anthropic.com/v1/messages
  headers: {"accept": "text/event-stream"}

事件类型:
  - message_start: 消息开始
  - content_block_start: 内容块开始
  - content_block_delta: 增量内容
  - content_block_stop: 内容块结束
  - message_delta: 消息增量
  - message_stop: 消息结束
  - ping: 心跳`,
    };

    const guide = guides[topic] || guides.overview;
    return `## Claude API 指南\n\n${guide}\n\n---\n使用 /claudeApi <topic> 查看特定主题。\n可用主题: overview, messages, tools, streaming`;
  },
};

export default claudeApiSkill;
