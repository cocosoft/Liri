/**
 * 知识库模块
 * 提供知识库的核心功能：混合搜索、编译、摘要、检查、迁移
 */

export {
  HybridKnowledgeRouter,
  getHybridKnowledgeRouter,
} from './HybridKnowledgeRouter';
export type { HybridSearchConfig } from './HybridKnowledgeRouter';

export { KnowledgeCompiler, runKnowledgeCompile } from './KnowledgeCompiler';
export type { CompileOptions, CompileResult } from './KnowledgeCompiler';

export {
  KnowledgeDigestService,
  getDefaultDigestService,
} from './KnowledgeDigestService';
export type { DocDigest, DigestCache } from './KnowledgeDigestService';

export {
  runKnowledgeLint,
  formatLintResult,
  KnowledgeLinter,
} from './KnowledgeLinter';
export type { LintResult, LintIssue } from './KnowledgeLinter';

export {
  migrateKnowledgeBase,
  getOldKnowledgePath,
  getNewKnowledgePath,
} from './KnowledgeMigration';
export type { MigrationResult } from './KnowledgeMigration';
