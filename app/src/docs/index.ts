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
 * 文档系统入口
 * 提供文档管理的统一接口
 */

export { ExampleCommands, exampleCommands } from './ExampleCommands.js';
export { ReleaseNotes, releaseNotes } from './ReleaseNotes.js';
export { ErrorMessages, errorMessages } from './ErrorMessages.js';
export { I18nManager, i18nManager } from './I18nManager.js';
export { ContextHelp, contextHelp } from './ContextHelp.js';
export { DocsSearch, docsSearch } from './DocsSearch.js';
export {
  KnowledgeRouter,
  knowledgeRouter,
  getKnowledgeRouter,
} from './KnowledgeRouter.js';
export {
  DocumentVersionService,
  createDocumentVersionService,
  getDefaultDocumentVersionService,
} from './DocumentVersionService.js';
export {
  TemplateService,
  createTemplateService,
  getDefaultTemplateService,
} from './TemplateService.js';
export { TemplateRecommender } from './TemplateRecommender.js';
export { FileDocsProvider, fileDocsProvider } from './FileDocsProvider.js';

export type {
  DocumentVersionMetadata,
  DocumentVersionContent,
  DocumentVersionHistory,
  DocumentVersionDiff,
  DocumentVersionStatus,
} from './DocumentVersionService.js';

export type {
  TemplateVariable,
  TemplateDefinition,
  TemplateRenderResult,
  TemplateSearchFilter,
} from './TemplateService.js';

export type {
  TemplateScore,
  RecommendationContext,
} from './TemplateRecommender.js';

export type {
  KnowledgeRoute,
  KnowledgeRouterOptions,
} from './KnowledgeRouter.js';

export type { SearchQueryRecord, SearchAnalyticsData } from './DocsSearch.js';

export type {
  ExampleCommand,
  ReleaseNote,
  ErrorMessageEntry,
  LanguagePack,
  ContextHelpEntry,
  ContextMatchCondition,
  SearchResult,
  DocsStats,
} from './types.js';

export { ExampleCategory } from './types.js';
