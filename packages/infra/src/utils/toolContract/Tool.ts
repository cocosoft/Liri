/**
 * 工具接口定义
 * 参考CC_CODE的Tool接口设计，适应backend现有架构
 */
import type { ToolResult } from './ToolResult';
import type { PermissionResult } from './PermissionResult';
import type { ToolProgressData } from './ToolProgress';
import type { ToolRuntimePermissionContext } from './PermissionContext';
import type { ProtocolMessage } from '@openliri/kernel';
import type { SharedToolRiskLevel } from '@shared/types';

export type { ToolResult };

/**
 * 工具参数校验结果（判别联合）
 *
 * 2026-10-31 由 `ValidationResult` 改名：原名与 `common/types` 的
 * `{valid, errors}` 结构重名（`lint:infra` R4 同名导出），语义也不同 ⇒ 前缀化以消除歧义。
 */
export type ToolValidationResult =
  | { result: true }
  | {
      result: false;
      message: string;
      errorCode?: number;
    };

/**
 * 中断行为策略
 */
export type InterruptBehavior = 'cancel' | 'block';

/**
 * 工具标签枚举
 * 用于对工具进行分类，支持按标签过滤和管理
 */
export enum ToolTag {
  READ = 'read',
  WRITE = 'write',
  NETWORK = 'network',
  AGENT = 'agent',
  CODE = 'code',
  FILE = 'file',
  SYSTEM = 'system',
  AI = 'ai',
}

/**
 * 工具参数类型
 */
export interface ToolParam {
  name: string;
  type: string;
  description: string;
  required: boolean;
  default?: unknown;
  enum?: string[];
  example?: unknown;
  minimum?: number;
  maximum?: number;
  /** 数组元素 schema（当 type === 'array' 时使用） */
  items?: {
    type: string;
    description?: string;
    properties?: Record<string, ToolParam>;
    required?: string[];
  };
  /** 数组最小长度（当 type === 'array' 时使用） */
  minLength?: number;
  /** 数组最大长度（当 type === 'array' 时使用） */
  maxLength?: number;
}

/**
 * 工具**能力分级**（D5，2026-10-11 用户裁定「采纳 · 渐进棘轮」）。
 *
 * - `read`：不改动任何状态（读/查/取）；
 * - `write-local`：仅改本地状态（文件/DB/内存）；
 * - `write-external`：对**外部系统/其他参与者**产生可见影响；
 * - `execute`：执行任意代码/命令（最宽能力）。
 */
export type ToolCapabilityLevel =
  | 'read'
  | 'write-local'
  | 'write-external'
  | 'execute';

/**
 * 工具**风险分级**（由能力 + 破坏性派生；供审批/HITL 分级用）。
 *
 * ⚠️ **单一事实源在 `shared/types/tool-visibility.ts`**（2026-10-16，P3 工具设置页）：
 * 该枚举同时被前端设置页消费（风险徽标 + 二次确认）⇒ 若在此再写一份联合即构成
 * 双轨（R02「数据模型统一」/ CS01）⇒ 本处改为**别名**，取值只在 shared 定义一次。
 */
export type ToolRiskLevel = SharedToolRiskLevel;

/** 工具沙箱级别（与 `BaseTool.sandboxLevel` 同域） */
export type ToolSandboxLevel = 'none' | 'readonly' | 'file-io' | 'execution';

/**
 * 本次执行的**沙箱模式**（PR-3a，2026-10-23）。
 *
 * - `landlock`：Linux Landlock 域内执行（`sandbox/landlock`，FS/网络白名单受限）；
 * - `container`：容器内执行（Docker 适配器）；
 * - `ssh` / `pty`：远端或伪终端沙箱；
 * - `none`：**无隔离证据**（含"开关关闭"与"能力不可用"）。
 *
 * ⚠️ 本层（infra）不 import `sandbox/`（app）⇒ 取值在此声明，由 `sandbox/` 侧做同值映射。
 */
export type SandboxExecutionMode =
  | 'landlock'
  | 'container'
  | 'ssh'
  | 'pty'
  | 'none';

/** 沙箱权限位（与 `sandbox.permissionLevel` 取值一致：`readonly` < `standard` < `full`） */
export type SandboxPermissionLevel = 'readonly' | 'standard' | 'full';

/**
 * 本次执行的沙箱上下文信号（PR-3a）。
 *
 * 值来自**执行入口**（配置 + 平台 + 适配器事实），不来自工具名猜测（CS02）。
 */
export interface SandboxExecutionSignal {
  mode: SandboxExecutionMode;
  permissionLevel: SandboxPermissionLevel;
  /**
   * 方案 A（2026-10-23）：**文件 IO 是否可证落在隔离环境内**。
   *
   * `mode` 只说明"环境具备隔离能力"（Landlock 仅包住命令子进程）；文件类工具走宿主
   * `node:fs` ⇒ 必须有独立证据。当前唯一来源 = 默认工作区适配器为 `container`/`ssh`
   * （`WorkspaceBase.isolationMode()`）。缺省/`false` ⇒ 文件类能力**不豁免**。
   */
  fileIoIsolated?: boolean;
  /**
   * 方案 A 扩展（2026-10-23，§12.15）：**已挂载的宿主根**（宿主绝对路径列表）。
   *
   * 用途：某些文件工具的实际落点**不在**会话工作区根下（如 `write_project_file` 落在
   * 项目 sandbox）⇒ 仅凭 `fileIoIsolated` 无法证明"这一次写"在隔离环境内。
   * 提供本字段后，沙箱豁免的 S4b 会要求工具的 `resolveFileIoRoot(input)` 落在其中之一；
   * 未提供/未覆盖 ⇒ 不豁免（fail-closed）。
   */
  fileIoRoots?: string[];
}

/**
 * 工具**风险类别声明**（PR-0，2026-10-23）。
 *
 * 取值与 `permission/types/RiskClass.ts` 的 `RiskClass` 枚举**逐字一致**（字符串联合在此声明，
 * 避免 `utils → app/permission` 的分层倒挂；permission 侧做同值映射）。
 *
 * 优先级（由 `tools/toolRiskClass.ts` 统一解析）：
 *   `riskClassFor(input)` > `riskClass` > 结构化派生（`TOOL_EFFECTS` + `sandboxLevel`）> 未声明
 *
 * ⚠️ 不允许再用**工具名关键词**猜风险（CS02）；`inferRiskClass` 仅作过渡兜底。
 */
export type ToolRiskClass =
  | 'read'
  | 'write'
  | 'shell'
  | 'external'
  | 'discuss'
  | 'undeclared';

/**
 * 工具**能力/风险描述符**（D5 复用既有元数据的**单一形态**）。
 *
 * 派生实现见 `tools/toolCapability.ts` 的纯函数 `deriveFromLegacyEffects()`
 * （**不新建子系统**，CS01；`Tool` 为 interface，故派生落 `BaseTool` 实现）。
 *
 * ⚠️ **边界（TG-1 / 2026-10-12 裁断：「保持独立，严禁并入工具契约」）**：本描述符描述工具的
 * **静态固有属性**（能力 / 风险 / 沙箱），属**能力域**。**严禁**把
 * `permission/ApprovedCommandRegistry` 的 `capabilityDigest` —— 即「特定会话 + 精确命令语义」的
 * **执行授权指纹**，属**权限域** —— 并入此处：二者语义正交，合并会把权限指纹**回流污染**工具
 * 的基础声明（CS01 / R02-002 同名不同物）。该字段**无需要**登记 R02-002 排除表（R02-002 只扫描
 * **导出符号**，不扫描 interface 字段）。
 */
export interface ToolCapabilityDescriptor {
  readonly capability: ToolCapabilityLevel;
  readonly risk: ToolRiskLevel;
  readonly sandbox: ToolSandboxLevel;
}

// ─── 可挂起能力（可选实现；T1-2② / TG-2+TG-6，2026-10-13 · A 片）───────────────

/**
 * **续跑句柄**（不透明、**可序列化**的"续跑凭据"）。
 *
 * 中心层**只做不透明搬运**（不解释内容、不写日志、不落盘细节）—— 领域细节留实现
 * （如侧车作业 id / 远端 request id）。
 */
export type SnapshotHandle = Readonly<Record<string, unknown>>;

/**
 * 冻结作用域（U-14 阶段 1.3，2026-10-18）。
 *
 * 挂起协调器**按会话**挂起，而编排引擎可能同时承载多个会话的状态 ⇒ 若总是做全量快照，
 * 放行恢复时会把其它仍在运行的会话一起覆盖。携带 `sessionId` 时，实现方须只冻结/恢复
 * 该会话的状态；缺省 ⇒ 保持旧的全量语义（向后兼容）。
 */
export interface SnapshotFreezeScope {
  /** 仅冻结该会话相关状态；缺省 = 全量快照 */
  sessionId?: string;
}

/**
 * **可挂起能力**（**可选**实现；T1-2② / TG-2+TG-6）。
 *
 * 契约来源（`工具治理方案-20261012.md` 阶段 1.2 步骤 ②）：「长耗时侧车工具**不得同步阻塞** ——
 * 提交后须能向内核投影 `SUSPENDED`（冻结思考树/释放连接），完成后通知解冻续跑」。
 *
 * 落法：工具**显式实现**本接口后，中心层（挂起点 = 债二的 `BudgetSuspendCoordinator`）可
 * **探测**该能力 ⇒ 调 [`freezeForSuspend()`] 取句柄并投影 `SUSPENDED`；放行后续跑时
 * 调 [`resumeFromSnapshot(handle)`]。
 *
 * ⚠️ **声明式、零行为**：仅"实现 + 标记字面量 `true`"才被认定可挂起（探测见下方
 * [`isSnapshotCapable()`]）；**未实现者语义逐字等价现状**。
 * ⚠️ **不并入 `Tool` 基接口**：绝大多数工具是同步短任务，强制实现即造**无意义空实现**（CS03）。
 * ⚠️ **A 片范围（2026-10-13）**：只落**契约 + 探测**；真实的"提交→挂起→完成→续跑"端到端
 * （侧车**作业化** + 内核挂起联动 + 可复现测试）见 `.trae/specs/sidecar-async-suspend.md` 的 B/C 片。
 */
export interface ISnapshotCapable {
  /** 能力标记（**字面量 `true`** ⇒ typecheck 期可判别，避免"实现了但语义未声明"） */
  readonly snapshotCapable: true;
  /** 冻结快照（内核投影 `SUSPENDED` **之前**调用）：返回**可序列化**续跑句柄 */
  freezeForSuspend(
    scope?: SnapshotFreezeScope
  ): SnapshotHandle | Promise<SnapshotHandle>;
  /** 解冻续跑（内核放行**之后**调用）：以句柄恢复执行 */
  resumeFromSnapshot(handle: SnapshotHandle): void | Promise<void>;
}

/**
 * **探测：候选对象是否声明"可挂起"**（纯函数；**鸭子类型 + 字面量收窄**）。
 *
 * - 不 `import` 任何具体工具类、不改编排类树（T1-2② 的 A 片硬约束）；
 * - 非对象 / `null` / 未声明 / 标记非字面量 `true` / 缺任一方法 ⇒ **`false`**（**不臆造**、不抛异常）；
 * - 三个要件**同时**成立才算（避免"只挂标记不实现"或"只实现不声明"的半成品被误判为可挂起）。
 */
export function isSnapshotCapable(
  candidate: unknown
): candidate is ISnapshotCapable {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const c = candidate as {
    snapshotCapable?: unknown;
    freezeForSuspend?: unknown;
    resumeFromSnapshot?: unknown;
  };
  return (
    c.snapshotCapable === true &&
    typeof c.freezeForSuspend === 'function' &&
    typeof c.resumeFromSnapshot === 'function'
  );
}

/**
 * 工具信息类型
 */
export interface ToolInfo {
  name: string;
  description: string;
  params: ToolParam[];
  aliases?: string[];
  /** 旧名调用时的入参默认值（见 `Tool.aliasInputDefaults`；懒加载包装器据此透传） */
  aliasInputDefaults?: Readonly<Record<string, Record<string, unknown>>>;
  searchTips?: string[];
  searchHint?: string;
  enabled: boolean;
  readOnly: boolean;
  destructive: boolean;
  concurrencySafe: boolean;
  /**
   * 13-P1-2（2026-10-05）：重复调用是否与单次等价（唯一事实源 `tools/toolEffects.ts`，经
   * `BaseTool.getInfo()` 暴露）。**可选**：模块/插件类工具（knowledge/calendar/doc/MCP…）不在
   * 内建清单内，未提供时消费方按**保守**处理（`undefined` = 不可盲重试）。
   */
  idempotent?: boolean;
  /** 13-P1-2：副作用范围（未提供 ⇒ 消费方按 `'external'` 保守） */
  sideEffect?: 'none' | 'local' | 'external';
  /**
   * U-03（2026-10-19）：沙箱级别（能力声明位）。
   *
   * 由 `BaseTool.getInfo()` 透出，供**懒加载包装器**在未解包时也能判定"是否执行类"
   * （此前 `ToolLazyWrapper` 不转发该字段 ⇒ 延迟加载工具的能力判定失真）。
   */
  sandboxLevel?: ToolSandboxLevel;
  /**
   * PR-0（2026-10-23）：风险类别（声明值；未声明时由结构化派生，见 `tools/toolRiskClass.ts`）。
   * 供设置页「工具与命令」分组与 `GET /v1/tools` 展示。
   */
  riskClass?: ToolRiskClass;
  /**
   * U-03（2026-10-19）：**模型可见出参结构**（JSON Schema）。
   *
   * 与 `outputSchema`（运行期 `safeParse` 校验器）职责不同：本字段由
   * `ToolRegistry.getToolSchemas()` 直接作为 `output_schema` 下发给模型。
   * 放在 `ToolInfo` 而非仅 `Tool` 上，是为了让**懒加载包装器**在未解包时
   * 也能从注册快照读到它（否则 schema 生成时工具还没加载 ⇒ 声明形同虚设）。
   */
  outputJsonSchema?: Record<string, unknown>;
  deferred: boolean;
  alwaysLoad: boolean;
  interruptBehavior: InterruptBehavior;
  maxResultSizeChars?: number;
  tags?: ToolTag[];
  /**
   * D5（2026-10-11）：**能力/风险描述符**（派生自 `TOOL_EFFECTS` + `tags/isReadOnly/isDestructive`）。
   * **可选**：非 `BaseTool` 的工具（对象字面量/插件）未提供时消费方按需回退既有字段。
   */
  capability?: ToolCapabilityDescriptor;
}

/**
 * 工具进度回调类型
 */
export type ToolCallProgress<P extends ToolProgressData = ToolProgressData> =
  (progress: { toolUseID: string; data: P }) => void;

/**
 * 紧凑进度事件类型
 */
export type CompactProgressEvent =
  | {
      type: 'hooks_start';
      hookType: 'pre_compact' | 'post_compact' | 'session_start';
    }
  | { type: 'compact_start' }
  | { type: 'compact_end' };

/**
 * 工具使用上下文类型
 */
export interface ToolUseContext {
  /** 选项 */
  options: {
    commands: unknown[];
    debug: boolean;
    mainLoopModel: string;
    tools: Tools;
    verbose: boolean;
    thinkingConfig: unknown;
    mcpClients: unknown[];
    mcpResources: Record<string, unknown[]>;
    isNonInteractiveSession: boolean;
    agentDefinitions: unknown;
    maxBudgetUsd?: number;
    customSystemPrompt?: string;
    appendSystemPrompt?: string;
    querySource?: string;
    refreshTools?: () => Tools;
    cwd?: string;
    environment?: Record<string, string>;
  };
  abortController: AbortController;
  /** 会话 ID，用于关联到具体的聊天会话 */
  sessionId?: string;
  /**
   * A2-a（2026-10-18）：可选的工具策略上下文。
   *
   * 形状与 `tools/policy/ToolPolicy#PolicyContext` 对齐（本层为 infra，不能反向 import app）。
   * 未提供时执行收口按 `{ sessionId, userRole: 'owner' }` 兜底 ⇒ 零行为变更。
   */
  policyContext?: {
    userId?: string;
    userRole?: 'owner' | 'operator' | 'guest';
    sessionId?: string;
    profile?: 'coding' | 'messaging' | 'minimal';
    permissionMode?: string;
    attributes?: Record<string, unknown>;
  };
  /**
   * PR-3a（2026-10-23）：**本次执行的沙箱上下文**（由执行入口注入，见
   * `sandbox/sandboxExecutionSignal.ts`）。
   *
   * 用途：
   * - PR-3b 起 —— 统一判定链的「沙箱豁免」硬前提（S1 隔离可证 / S2 能力匹配 /
   *   S3 权限位覆盖 / S4 范围匹配）读本字段；
   * - PR-3a（本批）—— 仅作**证据面**：审批卡 metadata 记录 `sandboxMode` /
   *   `sandboxPermissionLevel`，**不改变**任何 allow / ask / deny 判定。
   *
   * ⚠️ **缺省 ⇒ 视为"未沙箱" ⇒ 一律不豁免**（fail-closed：不许把字段缺失当成"可以放行"）。
   */
  sandbox?: SandboxExecutionSignal;
  readFileState: unknown;
  /** B3：子代理嵌套深度（agent 工具递归上限检查，默认 ≤1） */
  subagentDepth?: number;
  getAppState(): unknown;
  setAppState(f: (prev: unknown) => unknown): void;
  setAppStateForTasks?: (f: (prev: unknown) => unknown) => void;
  handleElicitation?: (
    serverName: string,
    params: unknown,
    signal: AbortSignal
  ) => Promise<unknown>;
  setToolJSX?: (
    args: {
      jsx: unknown | null;
      shouldHidePromptInput: boolean;
      shouldContinueAnimation?: true;
      showSpinner?: boolean;
      isLocalJSXCommand?: boolean;
      isImmediate?: boolean;
      clearLocalJSX?: boolean;
    } | null
  ) => void;
  addNotification?: (notif: unknown) => void;
  appendSystemMessage?: (msg: unknown) => void;
  sendOSNotification?: (opts: {
    message: string;
    notificationType: string;
  }) => void;
  nestedMemoryAttachmentTriggers?: Set<string>;
  loadedNestedMemoryPaths?: Set<string>;
  dynamicSkillDirTriggers?: Set<string>;
  discoveredSkillNames?: Set<string>;
  userModified?: boolean;
  setInProgressToolUseIDs: (f: (prev: Set<string>) => Set<string>) => void;
  setHasInterruptibleToolInProgress?: (v: boolean) => void;
  setResponseLength: (f: (prev: number) => number) => void;
  setStreamMode?: (mode: string) => void;
  onCompactProgress?: (event: CompactProgressEvent) => void;
  setSDKStatus?: (status: unknown) => void;
  openMessageSelector?: () => void;
  updateFileHistoryState: (updater: (prev: unknown) => unknown) => void;
  updateAttributionState: (updater: (prev: unknown) => unknown) => void;
  setConversationId?: (id: string) => void;
  agentId?: string;
  agentType?: string;
  requireCanUseTool?: boolean;
  messages: ProtocolMessage[];
  fileReadingLimits?: { maxTokens?: number; maxSizeBytes?: number };
  globLimits?: { maxResults?: number };
  toolDecisions?: Map<
    string,
    { source: string; decision: 'accept' | 'reject'; timestamp: number }
  >;
  queryTracking?: { chainId: string; depth: number };
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null
  ) => (request: unknown) => Promise<unknown>;
  toolUseId?: string;
  criticalSystemReminder_EXPERIMENTAL?: string;
  preserveToolUseResults?: boolean;
  localDenialTracking?: unknown;
  contentReplacementState?: unknown;
  renderedSystemPrompt?: unknown;
  toolPermissionContext?: ToolRuntimePermissionContext;
  traceId?: string;
}

/**
 * 工具接口
 */
export interface Tool<
  Input = unknown,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> {
  /**
   * 工具名称
   */
  name: string;

  /**
   * 工具描述
   */
  description: string;

  /**
   * 工具参数
   */
  params: ToolParam[];

  /**
   * 工具别名
   */
  aliases?: string[];

  /**
   * 旧名（别名）调用时的**入参默认值**（P1 工具族合并，2026-10-30）。
   *
   * 场景：`vfs` 合并了 `read_vfs` / `write_vfs` …，旧名保留为 alias ⇒ 模型仍可能用旧名调用，
   * 而旧名的入参形态里没有 `op`。本表按**被调用的名字**给出缺省字段（如
   * `{ read_vfs: { op: 'read' } }`），由执行入口在**参数校验前**合并（显式入参优先）。
   *
   * 仅在 `请求名 !== tool.name` 时生效（真名调用不看本表）。
   */
  aliasInputDefaults?: Readonly<Record<string, Record<string, unknown>>>;

  /**
   * 搜索提示
   */
  searchHint?: string;

  /**
   * 搜索提示数组
   */
  searchTips?: string[];

  /**
   * 延迟加载标志
   */
  shouldDefer?: boolean;

  /**
   * 始终加载标志
   */
  alwaysLoad?: boolean;

  /**
   * 最大结果大小（字符数）
   */
  maxResultSizeChars?: number;

  /**
   * 工具标签列表
   */
  tags?: ToolTag[];

  /**
   * 沙箱级别（A-4，2026-10-18）：**能力声明位**。
   *
   * `execution` = 执行任意命令/代码（`bash` / `powershell` / `code_run`）；
   * 调用方应据此判定"是否执行类"，**不要**再按 `tool.name === 'bash'` 等字符串分支。
   * 非 `BaseTool` 实现可省略（缺省视为非执行类）。
   */
  sandboxLevel?: ToolSandboxLevel;

  /**
   * 文件类工具**实际落点根**（宿主绝对路径；2026-10-23 §12.15）。
   *
   * 例：`write_project_file` 落在项目 sandbox ⇒ 返回该根，沙箱豁免的 S4b 据此要求
   * "该根已被挂载进隔离环境"；未实现 ⇒ 不做额外要求（不影响既有工具）。
   * **必须同步**（权限判定是同步热路径）。
   */
  resolveFileIoRoot?(input: Record<string, unknown>): string | undefined;

  /**
   * PR-0（2026-10-23）：风险类别**静态声明**。缺省时由 `TOOL_EFFECTS` + `sandboxLevel`
   * 结构化派生（见 `tools/toolRiskClass.ts`），**不得**再按工具名猜测。
   */
  riskClass?: ToolRiskClass;

  /**
   * PR-0（2026-10-23）：风险类别**动态声明**（混合工具用；如 `pdf` 的
   * `extract/info` = read、`generate` = write）。优先于 `riskClass`。
   */
  riskClassFor?(input: Record<string, unknown>): ToolRiskClass;

  /**
   * PR-0（2026-10-23）：**派生**本次调用的风险类别（实现方内部可结合 `TOOL_EFFECTS` /
   * `sandboxLevel` 等结构化元数据）。权限层（infra）只调用本方法，**不反向依赖** `tools/`。
   */
  getRiskClass?(input?: Record<string, unknown>): ToolRiskClass;

  /**
   * PR-2（2026-10-23）：审批**授权维度**（可选）。
   *
   * 「始终允许 / 本会话都允许」按本方法返回的指纹生效，缺省由权限层回退为全参数
   * 稳定 JSON（`toolCallApprovalKey`）。声明示例：`file_write` 只按归一化路径，
   * 使"总是允许写这个文件"在内容变化时仍命中。
   */
  approvalFingerprint?(input: Record<string, unknown>): string;

  /**
   * 严格模式标志
   */
  strict?: boolean;

  /**
   * 检查工具是否启用
   */
  isEnabled(): boolean;

  /**
   * 检查工具是否只读
   */
  isReadOnly(input?: Record<string, unknown>): boolean;

  /**
   * 检查工具是否破坏性操作
   */
  isDestructive?(input?: Record<string, unknown>): boolean;

  /**
   * 检查工具是否开放世界操作
   */
  isOpenWorld?(input?: Record<string, unknown>): boolean;

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(input?: Record<string, unknown>): boolean;

  /**
   * 中断行为策略
   */
  interruptBehavior?(): InterruptBehavior;

  /**
   * 获取工具操作的文件路径
   */
  getPath?(input: Record<string, unknown>): string;

  /**
   * 执行工具
   */
  execute(
    input: Input,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<P>
  ): Promise<ToolResult<Output>>;

  /**
   * 调用工具（增强版）
   */
  call?(
    args: Input,
    context: ToolUseContext,
    onProgress?: ToolCallProgress<P>
  ): Promise<ToolResult<Output>>;

  /**
   * 检查权限
   */
  checkPermissions?(
    input: Input,
    context: ToolUseContext
  ): Promise<PermissionResult>;

  /**
   * 验证输入
   */
  validateInput?(input: Input): ToolValidationResult;

  /**
   * 带上下文的输入验证
   */
  validateInputWithContext?(
    input: Input,
    context: ToolUseContext
  ): Promise<ToolValidationResult>;

  /**
   * 获取工具信息
   */
  getInfo(): ToolInfo;

  /**
   * 获取工具描述（增强版）
   */
  getDescription?(
    input: Input,
    options: {
      isNonInteractiveSession: boolean;
      toolPermissionContext: unknown;
    }
  ): Promise<string>;

  /**
   * 输入Schema
   */
  inputSchema?: Input;

  /**
   * JSON格式的输入Schema（用于MCP工具）
   */
  inputJSONSchema?: unknown;

  /**
   * 出参运行期 schema（P1-3 A 档，2026-09-28）。
   *
   * **改前为 `unknown`** —— 字段早已存在，但该类型使**任何校验都不可能**（无法调用
   * `safeParse`）⇒ 等价于"只有占位、没有契约"。现收窄为结构化最小接口。
   *
   * 与泛型 `Output` **互补**：`Output` 只作用于**编译期**（对运行期数据无约束），本字段是
   * **运行期**校验 —— 在 `ToolExecutor` 的统一出口（`validateToolOutput`）调用其 `safeParse`。
   *
   * 设计约定（**保守**，避免"加校验反而打断工具"）：
   * - **可选**：未声明者**完全不受影响**（不校验、不报错）；
   * - **不阻断**：校验失败仅**记录 + 如实标注**（写入 `metadata.outputSchemaError`），**不抛错**；
   * - 结构刻意**不 import zod 类型**：零新增依赖，且兼容 zod 的 `safeParse` 形态
   *   （MCP 工具亦可自行适配）。
   */
  outputSchema?: {
    safeParse(data: unknown): { success: boolean; error?: unknown };
  };

  /**
   * 出参**模型可见结构**（JSON Schema，U-03 2026-10-19）。
   *
   * 与 `outputSchema`（运行期 `safeParse` 校验器）**职责不同**：本字段由
   * `ToolRegistry.getToolSchemas()` 直接作为 `output_schema` 下发给模型，
   * 让模型知道结果长什么样；未声明时保持历史占位 `{ content: string }`（零破坏）。
   *
   * 约定（U-03 2026-10-19 扩展）：
   * - `type: 'object'` 且带 `properties`；或
   * - `type: 'array'`（`items` 可选）—— 供 `data` 本身即数组的工具（如 `glob`）声明。
   * 形状不符按"未声明"处理（不阻断 schema 生成）。
   */
  outputJsonSchema?: Record<string, unknown>;

  /**
   * 判断两个输入是否等价
   */
  inputsEquivalent?(a: Input, b: Input): boolean;

  /**
   * 是否为搜索或读取命令
   */
  isSearchOrReadCommand?(input: Input): {
    isSearch: boolean;
    isRead: boolean;
    isList?: boolean;
  };

  /**
   * 是否为开放世界操作
   */
  isOpenWorld?(input: Input): boolean;

  /**
   * 是否需要用户交互
   */
  requiresUserInteraction?(): boolean;

  /**
   * 是否为MCP工具
   */
  isMcp?: boolean;

  /**
   * 是否为LSP工具
   */
  isLsp?: boolean;

  /**
   * MCP信息
   */
  mcpInfo?: { serverName: string; toolName: string };

  /**
   * 填充可观察输入
   */
  backfillObservableInput?(input: Record<string, unknown>): void;

  /**
   * 准备权限匹配器
   */
  preparePermissionMatcher?(
    input: Input
  ): Promise<(pattern: string) => boolean>;

  /**
   * 获取面向用户的名称
   */
  userFacingName?(input?: Partial<Input>): string;

  /**
   * 获取面向用户的背景颜色
   */
  userFacingNameBackgroundColor?(input?: Partial<Input>): string | undefined;

  /**
   * 是否为透明包装器
   */
  isTransparentWrapper?(): boolean;

  /**
   * 获取工具使用摘要
   */
  getToolUseSummary?(input?: Partial<Input>): string | null;

  /**
   * 获取活动描述
   */
  getActivityDescription?(input?: Partial<Input>): string | null;

  /**
   * 转换为自动分类器输入
   */
  toAutoClassifierInput?(input: Input): unknown;

  /**
   * 映射工具结果到工具结果块参数
   */
  mapToolResultToToolResultBlockParam?(
    content: Output,
    toolUseID: string
  ): { content: unknown; type: string };

  /**
   * 获取工具使用摘要文本
   */
  getToolUseSummaryText?(input: Input): string;

  /**
   * 提取搜索文本
   */
  extractSearchText?(out: Output): string;

  /**
   * 渲染工具使用消息
   */
  renderToolUseMessage?(input: Input, options: { verbose: boolean }): unknown;

  /**
   * 渲染工具执行结果消息
   */
  renderToolResultMessage?(
    output: Output,
    progressMessages: unknown[],
    options: { verbose: boolean }
  ): unknown;

  /**
   * 渲染工具使用错误消息
   */
  renderToolUseErrorMessage?(
    error: string,
    options: { verbose: boolean }
  ): unknown;

  /**
   * 渲染工具进度消息
   */
  renderToolUseProgressMessage?(data: unknown): unknown;
}

/**
 * 工具集合类型
 */
export type Tools = readonly Tool[];

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  arguments?: Record<string, unknown> | string;
  toolName?: string;
  function?: { name: string };
  [key: string]: unknown;
}

export type ToolContext = Record<string, unknown>;

/**
 * 工具定义类型
 */
export type ToolDef<
  Input = unknown,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
> = Omit<
  Tool<Input, Output, P>,
  | 'isEnabled'
  | 'isConcurrencySafe'
  | 'isReadOnly'
  | 'isDestructive'
  | 'checkPermissions'
  | 'toAutoClassifierInput'
  | 'userFacingName'
  | 'getInfo'
  | 'description'
  | 'inputSchema'
  | 'outputSchema'
  | 'execute'
  | 'params'
  | 'renderToolResultMessage'
> &
  Partial<
    Pick<
      Tool<Input, Output, P>,
      | 'isEnabled'
      | 'isConcurrencySafe'
      | 'isReadOnly'
      | 'isDestructive'
      | 'checkPermissions'
      | 'toAutoClassifierInput'
      | 'userFacingName'
      | 'description'
      | 'inputSchema'
      | 'outputSchema'
      | 'execute'
      | 'params'
    >
  > & {
    prompt?: string | (() => string);
    renderToolUseMessage?: () => unknown;
    renderToolResultMessage?: (output: Output, toolUseId: string) => unknown;
    renderToolUseRejectedMessage?: () => unknown;
    renderToolUseErrorMessage?: () => unknown;
  };

/**
 * 工具默认值
 */
export const TOOL_DEFAULTS = {
  isEnabled: () => true,
  isConcurrencySafe: (_input?: unknown) => false,
  isReadOnly: (_input?: unknown) => false,
  isDestructive: (_input?: unknown) => false,
  checkPermissions: async (
    input: Record<string, unknown>,
    _context?: ToolUseContext
  ): Promise<PermissionResult> => {
    return {
      behavior: 'allow',
      updatedInput: input,
    };
  },
  toAutoClassifierInput: (_input?: unknown) => '',
  userFacingName: function (this: Tool, _input?: unknown) {
    return this.name;
  },
};

/**
 * 构建工具
 * 从部分定义构建完整工具，填充默认值
 */
export function buildTool<
  Input = unknown,
  Output = unknown,
  P extends ToolProgressData = ToolProgressData,
>(def: ToolDef<Input, Output, P>): Tool<Input, Output, P> {
  const tool = {
    ...TOOL_DEFAULTS,
    ...def,
    getInfo(): ToolInfo {
      return {
        name: this.name,
        description: this.description,
        params: this.params,
        aliases: this.aliases,
        searchTips: this.searchHint ? [this.searchHint] : undefined,
        enabled: this.isEnabled(),
        readOnly: this.isReadOnly(),
        destructive: this.isDestructive?.() || false,
        concurrencySafe: this.isConcurrencySafe(),
        deferred: this.shouldDefer || false,
        alwaysLoad: this.alwaysLoad || false,
        interruptBehavior: this.interruptBehavior?.() || 'block',
        maxResultSizeChars: this.maxResultSizeChars,
        tags: this.tags,
      };
    },
  } as Tool<Input, Output, P>;

  return tool;
}

/**
 * 检查工具是否匹配名称（主名称或别名）
 */
export function toolMatchesName(
  tool: { name: string; aliases?: string[] },
  name: string
): boolean {
  return tool.name === name || (tool.aliases?.includes(name) ?? false);
}

/**
 * 通过名称查找工具
 *
 * **真实名优先于别名** —— 与 [`ToolRegistry.getTool()`](../ToolRegistry.ts)（先 `tools.has(name)`
 * 再 `aliases.get(name)`）**口径一致**。
 *
 * 依据（2026-09-29 实测）：别名可能与**他人真实名**冲突（`TodoWriteTool` 曾把真实工具名
 * `create_task_list` 当别名）⇒ 此时按数组顺序 `find` 会返回**别名持有者**而非真实工具，
 * 使 `tool_search(select:<真实名>)` 指错工具（实测被引向 `todo_write`）。
 */
export function findToolByName(tools: Tools, name: string): Tool | undefined {
  return (
    tools.find((t) => t.name === name) ??
    tools.find((t) => toolMatchesName(t, name))
  );
}
