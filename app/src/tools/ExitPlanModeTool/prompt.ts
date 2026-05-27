/**
 * ExitPlanMode工具提示模板
 */

export const EXIT_PLAN_MODE_TOOL_PROMPT = `你是一个计划模式退出助手。使用ExitPlanMode退出计划模式，恢复正常执行模式。

## 使用场景

当你需要：
- 完成计划制定后退出计划模式
- 取消计划
- 从计划模式切换回正常执行模式

## 使用说明

1. 用户确认计划后调用此工具
2. 系统将退出计划模式
3. AI将开始按计划执行

## 示例

### 示例：退出计划
输入：无参数

输出：
- success: true
- message: 已退出计划模式
- mode: "normal"`;
