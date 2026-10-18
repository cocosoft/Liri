/**
 * 工具结果大小限制常量
 *
 * `@kind` 四分类（清单 §5 D-1）：本文件 B 类默认值统一来自 `./defaults.ts`
 * （`LIRI_*` 环境变量可覆盖）；`BYTES_PER_TOKEN` 属 A 类（换算常数）。
 *
 * D-2（2026-10-18）：7 个零消费者上限已删除（`MAX_TOOL_RESULT_TOKENS` /
 * `TOOL_SUMMARY_MAX_LENGTH` / `TOOL_RESULT_STORAGE_DIR` / `TOOL_RESULT_PREVIEW_MAX_LENGTH` /
 * `DEFAULT_TOOL_TIMEOUT` / `MAX_CONCURRENT_TOOLS` / `MAX_TOOL_RETRIES`）；
 * 仅保留上下文与落盘链路的真实消费面。
 */

import { getRuntimeDefaults } from './defaults';

/** B 类默认值快照（模块加载时读一次 env ⇒「启动前设置生效」） */
const B = getRuntimeDefaults();

/**
 * 工具结果在持久化到磁盘前的默认最大字符数
 * 超过此限制时，结果将保存到文件，模型收到文件路径而非完整内容
 *
 * @kind B
 */
export const DEFAULT_MAX_RESULT_SIZE_CHARS = B.defaultMaxResultSizeChars;

/**
 * 用于从字节大小计算token数的每token字节数估算
 *
 * @kind A
 */
export const BYTES_PER_TOKEN = 4;

/**
 * 工具结果注入**上下文**的最大字节数（由 token 限制推导）—— **上下文域**专属。
 *
 * ⚠️ 与 `services/toolResultStorage` 的**落盘**阈值 `MAX_TOOL_RESULT_BYTES`（1_000_000，
 * 超过则持久化到磁盘并替换为预览）**不是同一事实** ⇒ B5-2-62 按域消歧改名
 * （原两处同名：本处 400_000 上下文上限 vs 存储侧 1MB 落盘阈值）。
 *
 * @kind B
 */
export const CONTEXT_MAX_TOOL_RESULT_BYTES = B.contextMaxToolResultBytes;
