/**
 * 本地模型服务探测的默认参数（G1，2026-11-14）
 *
 * 独立成 `defaults.ts` 是门禁口径（`lint:consts` D-2：`*_TIMEOUT/_MS` 类常量
 * 只允许落在 `constants/` 或 `defaults.ts`）—— 不是为拆文件而拆文件。
 */

/**
 * 探测总预算。
 *
 * 本机连接被拒（服务未启动）是**瞬时**返回，2.5s 只用于兜住"能路由但无响应"的极端情况，
 * 避免探测拖住 onboard。
 */
export const LOCAL_SERVICE_DETECT_TIMEOUT_MS = 2500;
