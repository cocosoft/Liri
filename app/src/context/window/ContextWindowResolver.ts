/**
 * 2026-10-01 B14b（甲′）步 3 —— **原址转出 shim**。
 *
 * 本文件（`context/window/ContextWindowResolver.ts`）已迁至 **`utils/ContextWindowResolver.ts`**（infra）：
 * 其唯一 app 层耦合（静态 `@modules/ai` 的 `ModelRegistry`）已在步 1–2 解除，改为
 * `utils/ContextWindowResolver` 自持的 infra 级窗口缓存（由 `ModelRegistry` 同步推入）
 * ⇒ 本文件由此 **app-free**，可落 infra。
 *
 * 保留本路径作**再导出**，使 `context/**` 既有消费方（~9 处）与 `tests/context/*` **零改动**。
 * 依 R05-013 处置口径：**再导出不计入类型中心冲突**（合法手法）。
 *
 * 迁移动机：`session/SessionGateway.ts` 经 `@modules/context` 取 `resolveContextWindow`
 * 构成 `session(service) -> context(app)` 倒挂（layer-inversion B14）。迁移后该取用改指
 * `@modules/utils/ContextWindowResolver`（service -> infra，合法）。
 *
 * ⚠️ 收口须注意：B14 未清零的**真实根因**是同文件 L29 的**相对路径**类型导入
 * `'../context/types/Context'`（写的是相对路径而非 `@modules/context`，故长期未被识别）——
 * 已改指类型中心 `'../types/context'` 后，`session -> context` 的「文件 × 模块」对方才消失，
 * `已豁免` 43 → 42。
 */
export * from '@modules/utils/ContextWindowResolver';
