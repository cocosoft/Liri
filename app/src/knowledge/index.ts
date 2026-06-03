// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 知识库模块
 * 提供知识库的核心功能：混合搜索、编译、摘要、检查、迁移、文件自动摄取
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

export {
  FileIngestionService,
  getDefaultIngestionService,
  resetDefaultIngestionService,
} from './ingestion/FileIngestionService';
export type {
  IngestionSource,
  FileCategory,
  IngestionResult,
  IngestionOptions,
} from './ingestion/FileIngestionService';

export {
  KnowledgeBaseRegistry,
  getDefaultKnowledgeBaseRegistry,
} from './KnowledgeBaseRegistry';
export type { KnowledgeBase, KnowledgeBaseMeta } from './KnowledgeBaseRegistry';

export { KnowledgeCompileScheduler } from './KnowledgeCompileScheduler';
export type {
  SchedulerConfig,
  SchedulerState,
} from './KnowledgeCompileScheduler';
