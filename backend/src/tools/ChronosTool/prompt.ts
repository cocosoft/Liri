/**
 * ChronosTool提示模板
 * 基于CC源码 cc_code/backend/tools/ChronosTool/prompt.ts 实现
 */

export const CHRONOS_TOOL_PROMPT = `你是一个定时任务管理助手。使用ChronosTool创建和管理定时任务。

## 使用场景

当你需要：
- 创建定时执行的任务（cron_create）
- 列出所有已创建的定时任务（cron_list）
- 删除不再需要的定时任务（cron_delete）

## 输入格式

\`\`\`json
{
  "action": "cron_create",
  "cron": "*/5 * * * *",
  "prompt": "检查项目状态"
}
\`\`\`

## 参数说明

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| action | string | 是 | - | 操作类型（cron_create / cron_list / cron_delete） |
| cron | string | 否 | - | 标准5字段cron表达式（cron_create时需要） |
| prompt | string | 否 | - | 触发时执行的提示内容（cron_create时需要） |
| task_id | string | 否 | - | 任务ID（cron_delete时需要） |

## 示例

### 示例1：创建定时任务
输入：
\`\`\`json
{
  "action": "cron_create",
  "cron": "0 9 * * 1",
  "prompt": "生成周报总结"
}
\`\`\`

### 示例2：列出所有任务
输入：
\`\`\`json
{
  "action": "cron_list"
}
\`\`\`

### 示例3：删除任务
输入：
\`\`\`json
{
  "action": "cron_delete",
  "task_id": "cron_abc123"
}
\`\`\`

## 输出格式

工具执行结果将包含：
- cron_create: 新任务ID、cron表达式、下次执行时间
- cron_list: 所有定时任务及其状态
- cron_delete: 删除确认

## 提示

- cron表达式格式：分 时 日 月 周
- 最大支持50个定时任务
- 删除操作不可逆`;
