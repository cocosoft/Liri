/**
 * API限制常量
 * 基于CC源码 cc_code/backend/constants/apiLimits.ts 实现
 * 定义API请求的服务端限制，保持此文件无依赖以防止循环导入
 */

// =============================================================================
// 图片限制
// =============================================================================

/**
 * 最大Base64编码图片大小（API强制限制）
 * API拒绝Base64字符串长度超过此值的图片
 * 注意：这是Base64长度，不是原始字节数。Base64增加约33%大小
 */
export const API_IMAGE_MAX_BASE64_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * 编码后不超过Base64限制的目标原始图片大小
 * Base64编码增加4/3大小，因此推导最大原始大小：
 * raw_size * 4/3 = base64_size → raw_size = base64_size * 3/4
 */
export const IMAGE_TARGET_RAW_SIZE = (API_IMAGE_MAX_BASE64_SIZE * 3) / 4; // 3.75 MB

/**
 * 客户端图片调整的最大尺寸
 * API内部将大于1568px的图片调整大小，但这是服务端处理不会导致错误
 * 客户端限制（2000px）略大以在有益时保留质量
 */
export const IMAGE_MAX_WIDTH = 2000;
export const IMAGE_MAX_HEIGHT = 2000;

// =============================================================================
// PDF限制
// =============================================================================

/**
 * 适合API请求限制的最大原始PDF文件大小
 * API有32MB总请求大小限制。Base64编码增加约33%（4/3）
 * 20MB原始 → 约27MB Base64，留出对话上下文空间
 */
export const PDF_TARGET_RAW_SIZE = 20 * 1024 * 1024; // 20 MB

/**
 * API接受的PDF最大页数
 */
export const API_PDF_MAX_PAGES = 100;

/**
 * PDF提取为页面图片而非Base64文档块的大小阈值
 * 超过此大小的PDF将提取为页面图片
 */
export const PDF_EXTRACT_SIZE_THRESHOLD = 3 * 1024 * 1024; // 3 MB

/**
 * 页面提取路径的最大PDF文件大小
 * 超过此大小的PDF将被拒绝以避免处理超大文件
 */
export const PDF_MAX_EXTRACT_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * Read工具单次调用中提取的最大PDF页数
 */
export const PDF_MAX_PAGES_PER_READ = 20;

/**
 * @提及时内联到上下文的PDF页数阈值
 * 超过此页数的PDF将使用引用方式而非内联
 */
export const PDF_AT_MENTION_INLINE_THRESHOLD = 10;

// =============================================================================
// 媒体限制
// =============================================================================

/**
 * 每个API请求允许的最大媒体项数（图片+PDF）
 * API拒绝超过此限制的请求并给出令人困惑的错误
 * 我们在客户端验证以提供清晰的错误消息
 */
export const API_MAX_MEDIA_PER_REQUEST = 100;
