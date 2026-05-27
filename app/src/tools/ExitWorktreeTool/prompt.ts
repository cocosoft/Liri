/**
 * ExitWorktree工具提示模板
 */

export const EXIT_WORKTREE_TOOL_PROMPT = `你是一个Worktree退出助手。使用ExitWorktree退出工作区模式，恢复到主工作区。

## 使用场景

当你需要：
- 完成工作区任务后退出
- 取消工作区操作
- 从工作区模式切换回主工作区

## 使用说明

1. 任务完成后调用此工具
2. 系统会将工作区变更合并
3. AI将退出工作区模式

## 示例

### 示例：退出工作区
输入：无参数

输出：
- success: true
- message: 已退出工作区模式
- mode: "normal"`;
