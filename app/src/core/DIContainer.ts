/**
 * 依赖注入容器 — 重导出入口
 *
 * 实际实现在 core/di/ 子目录中，此文件保持向后兼容。
 * 参见：
 *   - core/di/DIContainer.ts — 主容器类
 *   - core/di/ContainerScope.ts — 作用域管理
 *   - core/di/CycleDetector.ts — 循环依赖检测
 *   - core/di/AutoWiringEngine.ts — 自动装配
 *   - core/di/DisposeManager.ts — 生命周期管理
 *   - core/di/types.ts — 类型定义
 */
export * from './di/index';
