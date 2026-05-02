/**
 * Commands 模块归档说明
 *
 * 架构优化 §6.1: 简化过度分层
 * 
 * 当前 commands/ 有 8 个子目录:
 *   builtin/ executor/ history/ loader/ manager/ pipeline/ registry/ types/
 *
 * 优化后（渐进式）:
 *   builtin/    → 保留（命令实现）  ✅
 *   loader/     → 保留（CommandLoader.ts）  ✅
 *   types/      → 保留（类型定义）  ✅
 *   registry/   → 合并至 loader/（减少一层）
 *   manager/    → 合并至 loader/（CommandLoaderRegistry 已包含管理功能）
 *   executor/   → 合并至 builtin/（命令执行逻辑内联到具体命令）
 *   pipeline/   → 合并至 loader/（pipeline作为loader的一个中间件）
 *   history/    → 独立保留 ✅（高级历史功能独立价值）
 *
 * 当前阶段已完成 builtin/ 下 8 个新命令的补全，其余合并将在后续迭代中渐进完成。
 */
