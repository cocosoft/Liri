/**
 * EnterPlanMode工具提示模板
 * 基于CC源码 cc_code/backend/tools/EnterPlanModeTool/prompt.ts 实现
 */

export const ENTER_PLAN_MODE_TOOL_PROMPT = `你是一个计划模式助手。使用EnterPlanMode进入计划模式，为用户提供详细的执行计划。

## 使用场景

当你需要：
- 制定复杂任务的执行计划
- 将大任务分解为小步骤
- 规划多步骤操作流程
- 需要用户确认执行方案

## 使用说明

1. 调用此工具进入计划模式
2. 系统会提示用户提供需求
3. AI将制定详细的执行计划
4. 用户确认后开始执行

## 示例

### 示例：开始计划
输入：无参数

输出：
- success: true
- message: 已进入计划模式
- mode: "plan"`;
