/**
 * 上下文引擎模块导出
 * 对标 Hermes agent/context_engine.py
 */
export { IContextEngine, DEFAULT_COMPRESSION_CONFIG } from './IContextEngine';
export type { CompressionConfig, CompressionResult } from './IContextEngine';
export { DefaultContextEngine } from './DefaultContextEngine';
export { SummaryTemplate } from './SummaryTemplate';
export type {
  StructuredSummary,
  IssueEntry,
  IssueStatus,
  DecisionRecord,
  FileChangeSummary,
} from './SummaryTemplate';
export { JsonTruncator, DEFAULT_TRUNCATOR_CONFIG } from './JsonTruncator';
export type { JsonTruncatorConfig } from './JsonTruncator';
export { ContextEngineRegistry } from './ContextEngineRegistry';
export type { CompressionFeature } from './ContextEngineRegistry';
export { SummarizerEngine } from './SummarizerEngine';
export { TruncatorEngine } from './TruncatorEngine';
export { HybridEngine } from './HybridEngine';
export { ContextTracker } from './ContextTracker';
export type { CompressionRecord } from './ContextTracker';
