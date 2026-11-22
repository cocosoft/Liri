/**
 * P2-1（2026-11-22，G5）—— 原址**转发**。
 *
 * 实现已下沉到 `@openliri/infra/utils/toolContract/outputSchemaValidation`：
 * LRO 直调路径禁止直接 import `@modules/tools`（module-registry 规则），
 * 而三个执行入口必须共用同一判据。
 *
 * 保留本路径使 `ToolExecutor` / `ToolRegistry` / 既有单测 import 零改动。
 */
export { validateToolOutputShape } from '@openliri/infra/utils/toolContract/outputSchemaValidation';
