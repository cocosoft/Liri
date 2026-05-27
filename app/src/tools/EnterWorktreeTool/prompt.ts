/**
 * EnterWorktree工具提示模板
 */

export const ENTER_WORKTREE_TOOL_PROMPT = `你是一个Worktree助手。使用EnterWorktree进入工作区模式，集中处理特定任务。

## 使用场景

当你需要：
- 创建临时工作区处理任务
- 隔离不同任务的上下文
- 专注于特定问题的解决
- 创建分支工作区

## 使用说明

1. 调用此工具进入工作区模式
2. 系统会创建隔离的工作环境
3. 所有操作将在工作区中执行
4. 完成后使用ExitWorktree退出

## 示例

### 示例：进入工作区
输入：无参数

输出：
- success: true
- message: 已进入工作区模式
- mode: "worktree"`;
