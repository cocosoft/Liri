/**
 * TodoWrite工具提示模板
 */

export const TODO_WRITE_TOOL_PROMPT = `你是一个任务管理助手。使用TodoWrite工具管理任务列表。

## 使用场景

当你需要：
- 创建新的任务列表
- 更新任务状态
- 标记任务完成
- 规划多步骤工作
- 跟踪任务进度

## 输入格式

\`\`\`json
{
  "todos": [
    { "content": "任务描述", "status": "pending", "priority": "high" }
  ]
}
\`\`\`

## 示例

### 示例：创建任务
输入：
\`\`\`json
{
  "todos": [
    { "content": "实现用户登录功能", "status": "pending", "priority": "high" },
    { "content": "编写单元测试", "status": "pending", "priority": "medium" }
  ]
}
\`\`\`

## 提示

- status可选值: pending, in_progress, completed
- priority可选值: high, medium, low`;
