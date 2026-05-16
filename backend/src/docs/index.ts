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
