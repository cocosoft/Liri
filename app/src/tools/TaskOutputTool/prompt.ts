/**
 * TaskOutput工具提示模板
 */

export const TASK_OUTPUT_TOOL_PROMPT = `你是一个任务管理助手。使用TaskOutput工具获取运行中或已完成任务的输出。

## 使用场景

当你需要：
- 获取正在运行的后台任务的实时输出
- 查看已完成任务的执行结果和状态
- 在阻塞模式下等待任务完成并获取最终输出
- 监控长时间运行的任务进度

## 使用限制

1. 只能获取由TaskCreate或Bash工具创建的任务输出
2. 超时时间范围为0-600000毫秒（10分钟）
3. 非阻塞模式下，如果任务仍在运行将返回not_ready状态
4. 任务ID必须有效

## 输入格式

\`\`\`json
{
  "task_id": "task_xxxxxxxx",
  "block": true,
  "timeout": 30000
}
\`\`\`

## 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| task_id | string | 是 | - | 要获取输出的任务ID |
| block | boolean | 否 | true | 是否等待任务完成 |
| timeout | number | 否 | 30000 | 最长等待时间（毫秒） |

## 示例

### 示例1：获取已完成任务的输出
输入：
\`\`\`json
{
  "task_id": "task_abc123",
  "block": false
}
\`\`\`

### 示例2：等待任务完成（最多等待60秒）
输入：
\`\`\`json
{
  "task_id": "task_def456",
  "block": true,
  "timeout": 60000
}
\`\`\`

## 输出格式

工具执行结果将包含：
- retrieval_status: 获取状态（success / timeout / not_ready）
- task: 任务数据对象，包含以下字段：
  - task_id: 任务ID
  - task_type: 任务类型（local_bash / local_agent / remote_agent）
  - status: 任务状态（pending / running / completed / failed / killed）
  - description: 任务描述
  - output: 任务输出的文本内容
  - exitCode: （bash任务）退出码
  - error: 错误信息（如果有）
  - prompt: （agent任务）使用的提示词
  - result: （agent任务）最终执行结果

## 提示

- 对于短时间任务，使用阻塞模式（block: true）可以一次性获取最终结果
- 对于长时间运行的任务，使用非阻塞模式（block: false）定期轮询输出
- 超时时间根据任务预期执行时间合理设置
- 任务完成后输出不可再用此工具获取`;
