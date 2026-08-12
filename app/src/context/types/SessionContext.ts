/**
 * 会话上下文（用户创建场景）
 *
 * R07-P1 归并：原此处独立定义 `SessionContext`（仅 sessionId），
 * 与 Context.ts 的系统注入版同名双定义。现统一 re-export Context.ts 版，
 * 字段集兼容两者（userId 已可选化）。
 */
export type { SessionContext } from './Context';
