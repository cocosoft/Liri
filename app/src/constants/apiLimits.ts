/**
 * API限制常量（**B 类：可调运行参数**）
 *
 * 定义 API 请求的服务端限制。默认值唯一来源为 `./defaults.ts`（`LIRI_*` 环境变量可覆盖）；
 * 本文件仅做具名导出，不重复写默认值。
 * 依赖方向：本文件 → `./defaults`（零依赖 leaf）⇒ 不成环。
 *
 * D-2（2026-10-18）：7 个零消费者 PDF / 媒体上限已删除（无任何读取点）；
 * 仅保留图片链路的真实消费面。
 */

import { getRuntimeDefaults } from './defaults';

/** B 类默认值快照（模块加载时读一次 env ⇒「启动前设置生效」） */
const B = getRuntimeDefaults();

// =============================================================================
// 图片限制
// =============================================================================

/**
 * 最大Base64编码图片大小（API强制限制）
 * API拒绝Base64字符串长度超过此值的图片
 * 注意：这是Base64长度，不是原始字节数。Base64增加约33%大小
 *
 * @kind B
 */
export const API_IMAGE_MAX_BASE64_SIZE = B.apiImageMaxBase64Size;

/**
 * 编码后不超过Base64限制的目标原始图片大小
 * Base64编码增加4/3大小，因此推导最大原始大小：
 * raw_size * 4/3 = base64_size → raw_size = base64_size * 3/4
 *
 * @kind B
 */
export const IMAGE_TARGET_RAW_SIZE = B.imageTargetRawSize;

/**
 * 客户端图片调整的最大尺寸
 * API内部将大于1568px的图片调整大小，但这是服务端处理不会导致错误
 * 客户端限制（2000px）略大以在有益时保留质量
 *
 * @kind B
 */
export const IMAGE_MAX_WIDTH = B.imageMaxWidth;
/** @kind B */
export const IMAGE_MAX_HEIGHT = B.imageMaxHeight;
