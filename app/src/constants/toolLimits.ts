/**
 * 工具结果大小限制常量
 */

/**
 * 工具结果在持久化到磁盘前的默认最大字符数
 * 超过此限制时，结果将保存到文件，模型收到文件路径而非完整内容
 */
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;

/**
 * 工具结果的最大token数
 * 基于工具结果大小分析，设置为合理的上限以防止过大结果消耗过多上下文
 * 约等于400KB文本（假设每token约4字节）
 */
export const MAX_TOOL_RESULT_TOKENS = 100_000;

/**
 * 用于从字节大小计算token数的每token字节数估算
 */
export const BYTES_PER_TOKEN = 4;

/**
 * 工具结果的最大字节数（由token限制推导）
 */
export const MAX_TOOL_RESULT_BYTES = MAX_TOOL_RESULT_TOKENS * BYTES_PER_TOKEN;

/**
 * 单个用户消息中工具结果块的最大总字符数
 * 当消息的块合计超过此值时，最大的块将被持久化到磁盘并替换为预览
 * 消息独立评估——一个turn中150K结果和下一个turn中150K结果都不受影响
 */
export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000;

/**
 * 压缩视图中工具摘要字符串的最大字符长度
 */
export const TOOL_SUMMARY_MAX_LENGTH = 50;

/**
 * 工具结果存储路径
 */
export const TOOL_RESULT_STORAGE_DIR = '.pyapp/tool_results';

/**
 * 工具结果预览最大长度
 */
export const TOOL_RESULT_PREVIEW_MAX_LENGTH = 500;

/**
 * 工具调用超时默认值（毫秒）
 */
export const DEFAULT_TOOL_TIMEOUT = 30_000;

/**
 * 工具调用最大并发数
 */
export const MAX_CONCURRENT_TOOLS = 10;

/**
 * 工具重试最大次数
 */
export const MAX_TOOL_RETRIES = 3;
