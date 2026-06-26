/**
 * 共享语音类型定义
 *
 * 前后端共用的语音相关类型定义，作为 API 契约的"单一事实来源"。
 * 事实源基准：app/src/services/voice/models/types.ts
 *
 * 管理规则：
 * 1. Review 要求：voice-types 修改须经 app 和 client 两方 review
 * 2. 防绕过：禁止在两端 local types 中重复定义已有共享类型
 */

// ============================================================
// STT（语音转文字）共享类型
// ============================================================

/**
 * STT 语段详情
 * 前后端定义完全一致
 */
export interface STTSegment {
  /** 语段文本 */
  text: string;
  /** 起始时间（秒） */
  start: number;
  /** 结束时间（秒） */
  end: number;
  /** 置信度（0-1） */
  confidence: number;
}

/**
 * 提供者信息对象
 * 前端渲染所需，后端返回 `provider` 字符串时由前端转换
 */
export interface ProviderInfo {
  id: string;
  name: string;
  type: string;
  available?: boolean;
}

/**
 * STT 转录结果
 *
 * 统一前后端差异：
 * - 后端 provider 为 string，前端 provider 为对象
 * - 前端 timing/status 为前端特有，共享中为可选
 * - 后端 error 为后端特有，共享中为可选
 */
export interface STTResult {
  /** 转录文本 */
  text: string;
  /** 置信度（0-1） */
  confidence: number;
  /** 是否为最终结果（流式场景） */
  isFinal: boolean;
  /** 音频时长（秒） */
  duration?: number;
  /** 语言代码 */
  language?: string;
  /**
   * 提供者
   * - 后端返回时：提供者 ID 字符串（如 "local"、"cloud"）
   * - 前端使用时：完整的提供者信息对象
   */
  provider?: string | ProviderInfo;
  /** 各语段详细结果 */
  segments?: STTSegment[];
  /** 转录耗时统计（前端特有，后端可为 undefined） */
  timing?: { elapsed: number; unit: string };
  /** 当前状态（前端特有，如 "completed"、"processing"） */
  status?: string;
  /** 错误信息：当转录失败时携带错误详情 */
  error?: { code: string; message: string };
}

// ============================================================
// 语音会话共享类型
// ============================================================

/**
 * 语音会话
 *
 * 后端 API 返回的语音会话记录，前端消费展示。
 * 事实源为前端定义，后端 API 响应格式与之对齐。
 */
export interface VoiceSession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  duration: number | null;
  transcript: string;
  responseAudioUrl: string | null;
  status: "active" | "completed" | "failed";
}
