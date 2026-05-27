/**
 * 嵌入模块统一导出
 */
export { EmbeddingBase } from './EmbeddingBase';
export type { EmbeddingOptions, EmbeddingResult } from './EmbeddingBase';
export { EmbeddingManager, globalEmbeddingManager } from './EmbeddingManager';
export type { EmbeddingConfig } from './EmbeddingManager';
export { OpenAIEmbeddingProvider } from './providers/OpenAIEmbeddingProvider';
export type { OpenAIEmbeddingConfig } from './providers/OpenAIEmbeddingProvider';
