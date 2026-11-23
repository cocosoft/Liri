// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Plan/Do **工作模式的取值契约**（2026-11-24，R00-003 下沉）
 *
 * 原定义在 `app/src/chat/workMode.ts`。但它的第一个职责是**HTTP 边界取值校验**
 * （`PATCH /v1/sessions/{id}/meta` 的 `work_mode`），而该 handler 属 service 层、
 * 不得静态依赖 app ⇒ 只能 `await import('@modules/chat')`，形成 R00-003 的动态跨层盲区。
 *
 * 取值本身是**跨层契约**（客户端发、后端校验、会话 metadata 存），与 `toolContract` 同类 ⇒
 * 下沉到 infra 的 `utils/contracts/`（跨层契约叶子）作为唯一事实源；app 侧 `chat/workMode.ts`
 * 只保留「模式 → 系统提示片段」这件事。
 *
 * 取值与后端会话 metadata 一致，**勿改名**。
 */
export const WORK_MODES = ['plan', 'do'] as const;

/** 工作模式（`plan` 规划 / `do` 执行） */
export type WorkMode = (typeof WORK_MODES)[number];

/** 取值校验（用于 HTTP 边界等外部输入；非法值必须 fail loud） */
export function isWorkMode(value: unknown): value is WorkMode {
  return (
    typeof value === 'string' && (WORK_MODES as readonly string[]).includes(value)
  );
}
