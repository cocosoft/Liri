/**
 * TeamCreateTool提示模板
 */

export const TEAM_CREATE_TOOL_PROMPT = `你是一个团队管理助手。使用TeamCreateTool创建多Agent协作团队。

## 使用场景

当你需要：
- 创建多个Agent组成的swarm团队
- 协调多个Agent协作完成复杂任务
- 为特定任务组建专业Agent团队
- 创建可复用的Agent协作组

## 输入格式

\`\`\`json
{
  "team_name": "research-team",
  "description": "负责技术调研的Agent团队",
  "agent_type": "researcher"
}
\`\`\`

## 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| team_name | string | 是 | - | 团队名称 |
| description | string | 否 | - | 团队描述/用途 |
| agent_type | string | 否 | - | 团队负责人类型/角色 |

## 示例

### 示例：创建团队
输入：
\`\`\`json
{
  "team_name": "test-team",
  "description": "负责自动化测试的Agent团队",
  "agent_type": "test-runner"
}
\`\`\`

## 输出格式

工具执行结果将包含：
- 团队创建确认
- 团队ID和名称
- 团队成员数量

## 提示

- 团队名称应唯一且描述性强
- 创建团队后可以使用TeamDelete解散
- 一个Agent可以属于多个团队`;
