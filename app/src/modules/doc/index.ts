/**
 * doc 模块入口
 * 导出 public API —— 所有对外接口
 */

export { DocModule } from './DocModule';

export {
  detectOfficeCLI,
  buildOfficeCLIMcpConfig,
  getVersionConstraint,
} from './detection/OfficeCLIDetector';
export { parseOfficeCLIError } from './detection/OfficeCLIErrorParser';
export {
  registerOfficeCLIInstallPrompt,
  registerOAuth2SetupPrompt,
  registerVersionMismatchPrompt,
} from './detection/elicitationPrompts';

export { MCPRequestQueue } from './concurrency/MCPRequestQueue';
export { ExecutionGuardian } from './execution/ExecutionGuardian';
export { ResourceGuardian } from './execution/ResourceGuardian';

export { docMetrics } from './observability/OfficeMetrics';
export { OfficeAuditLogger } from './audit/OfficeAuditLogger';
export { DocChannelHandler } from './channel/DocChannelHandler';
export { DocOrchestrator } from './orchestration/DocOrchestrator';
export { DocumentGraph } from './document/DocumentGraph';

export { TemplateEngine, BUILTIN_TEMPLATES } from './template/TemplateEngine';
export { TemplateMarketplace } from './template/TemplateMarketplace';

export {
  buildDocumentPreview,
  buildEmailConfirmation,
  buildCalendarCard,
} from './types/messageContent';
export { renderDocumentPreview } from './types/components';

// HTTP API handlers
export {
  handleDocStatus,
  handleOfficeCLIStatus,
  handleOfficeCLIInstall,
  handleDocCapabilities,
  handleDocDetect,
  handleDocUndo,
  handleDocGraph,
  handleDocDownload,
  handleDocCreate,
  handleDocRename,
  handleDocDelete,
  handleDocUpload,
  handleMailStatus,
  handleCalendarStatus,
  handleMailConfig,
  handleMailConfigRead,
  handleMailConfigDelete,
  handleMailSend,
  handleMailInbox,
  handleMailSent,
  handleMailSearch,
  handleMailPatchRead,
  handleMailDelete,
  handleMailRefresh,
  handleCalendarList,
  handleCalendarAdd,
  handleCalendarUpdate,
  handleCalendarDelete,
  handleCalendarExport,
  handleCalendarMerged,
  handleCalendarUpdateStatus,
  handleCalendarBatchStatus,
  handleCalendarOverdueCheck,
} from './api/officeHandlers';

// 类型导出
export type {
  OfficeCLIInfo,
  OfficeCLIVersionConstraint,
  DocCapabilityReport,
  DocModuleStatus,
  MCPRequestType,
  MCPRequest,
  MCPResponse,
  DocumentNode,
  AuditEntry,
  ResourceLimits,
} from './types';

// 分阶段文档工作流类型（设计方案 §4.2）
export type {
  DocFormat,
  DocOutlineNode,
  DocOutline,
  FilledOutline,
  OutlinePatch,
  PptRefineConfig,
  ImagePlaceholder,
} from './types/outline';
export { DEFAULT_PPT_CONFIG, validatePptConfig } from './types/outline';

export type { DocumentPreviewProps } from './types/components';
export type {
  DocumentPreviewData,
  EmailConfirmationData,
  CalendarCardData,
} from './types/messageContent';

// 分阶段文档工作流（设计方案 §4）
export {
  buildOutline,
  fillContent,
  generateImages,
  compose,
  diffOutline,
  runDocWorkflow,
  DocWorkflowProgressEmitter,
} from './workflow/DocWorkflow';
export type {
  BuildOutlineInput,
  FillContentOptions,
  GenerateImagesOptions,
  ComposeResult,
  RunDocWorkflowOptions,
  DocWorkflowProgressCallback,
} from './workflow/DocWorkflow';
export type {
  DocWorkflowProgressData,
  DocWorkflowStage,
  DocWorkflowStageStatus,
  DocWorkflowStageData,
  DocWorkflowNodeProgress,
} from './types/outline';
export {
  refineNode,
  refineOutline,
  refineTitle,
  refineBullets,
} from './workflow/PptRefiner';
export type { RefineResult, RefineViolation } from './workflow/PptRefiner';

// 占位符解析器（设计方案 §4.3）
export {
  parsePlaceholders,
  replacePlaceholders,
  deduplicatePlaceholders,
  buildPlaceholderText,
  generatePlaceholderId,
} from './placeholder/PlaceholderResolver';
