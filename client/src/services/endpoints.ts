/**
 * 前端契约路径（`/v1/*`）**按域**收口 —— 硬编码治理 `HD-P2-4`。
 *
 * **值逐字不变**（含模板插值位置）；本文件是这些路径的**唯一编辑点**。
 * 约定：无参路径用**字符串常量**，含参路径用**构造器函数**。
 */

/**
 * 本机回环 host（前端唯一编辑点；U-20/B5-2-91）。
 *
 * 后端对应真源为 `app/src/core/endpoints.ts` 的 `LOCAL_HTTP_HOST` —— 两个部署单元
 * 物理上无法共享模块，同值由 `crossDeploymentContract` 契约测试钉住。
 */
export const LOCAL_HOST = "127.0.0.1";

/**
 * 本地推理 / 本地服务的默认地址（前端唯一编辑点；U-20/B5-2-91）。
 *
 * 每个供应商同时保留 `loopback`（`127.0.0.1`）与 `hostname`（本机名形式）两种候选，供
 * 预设的 `endpointCandidates` 与设置面板占位符共用；**值逐字不变**。
 * 注意：`localAI` 的 8080 与后端 OAuth 回调服务数值相同、事实不同（不复用）。
 */
export const LOCAL_PROVIDER_ENDPOINTS = {
  ollama: {
    loopback: `http://${LOCAL_HOST}:11434/v1`,
    hostname: "http://localhost:11434/v1",
  },
  llamacpp: {
    loopback: `http://${LOCAL_HOST}:11435/v1`,
    hostname: "http://localhost:11435/v1",
  },
  lmStudio: {
    loopback: `http://${LOCAL_HOST}:1234/v1`,
    hostname: "http://localhost:1234/v1",
  },
  localAI: {
    loopback: `http://${LOCAL_HOST}:8080/v1`,
    hostname: "http://localhost:8080/v1",
  },
  /** MCP 设置面板的示例地址（仅占位提示，非实际连接目标） */
  mcpExample: "http://localhost:8080/mcp",
} as const;

/**
 * 官方供应商 API 基址 / 站点（前端唯一编辑点；U-20/B5-2-99）。
 *
 * 后端对应真源为 `app/src/core/providerEndpoints.ts`；两个部署单元无法共享模块，
 * 同值靠评审与契约测试保证。**值逐字不变**。
 */
export const PROVIDER_API_BASE_URLS = {
  openai: "https://api.openai.com",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
  deepseek: "https://api.deepseek.com",
  siliconflow: "https://api.siliconflow.cn",
  moonshot: "https://api.moonshot.cn",
  xai: "https://api.x.ai",
  openrouter: "https://openrouter.ai",
  bigmodel: "https://open.bigmodel.cn",
  dashscope: "https://dashscope.aliyuncs.com",
} as const;

export const PROVIDER_SITE_URLS = {
  openaiPlatform: "https://platform.openai.com",
  anthropicConsole: "https://console.anthropic.com",
  googleAiDev: "https://ai.google.dev",
  googleAiStudio: "https://aistudio.google.com",
} as const;

export const ENDPOINTS = {
  auth: {
    login: "/v1/auth/login",
    register: "/v1/auth/register",
    logout: "/v1/auth/logout",
    me: "/v1/auth/me",
    permissions: "/v1/auth/permissions",
  },
  apiKeys: {
    base: "/v1/apikeys",
    byId: (id: string) => `/v1/apikeys/${id}`,
  },
  agentTasks: {
    base: "/v1/agents/tasks",
    execute: "/v1/agents/tasks/execute",
    history: "/v1/agents/tasks/history",
    byId: (id: string) => `/v1/agents/tasks/${id}`,
    logs: (id: string) => `/v1/agents/tasks/${id}/logs`,
    cancel: (id: string) => `/v1/agents/tasks/${id}/cancel`,
    audit: (taskId: string) => `/v1/agents/tasks/${taskId}/audit`,
    recover: (taskId: string) => `/v1/agents/tasks/${taskId}/recover`,
    state: (taskId: string) => `/v1/agents/tasks/${taskId}/state`,
    output: (taskId: string) => `/v1/agents/tasks/${taskId}/output`,
    chat: (taskId: string) => `/v1/agents/tasks/${taskId}/chat`,
  },
  autoReply: {
    rules: "/v1/auto-reply/rules",
    byId: (ruleId: string) => `/v1/auto-reply/rules/${ruleId}`,
  },
  cron: {
    base: "/v1/cron",
    status: "/v1/cron/status",
    byId: (id: string) => `/v1/cron/${id}`,
    run: (id: string) => `/v1/cron/${id}/run`,
  },
  buddy: {
    dreams: "/v1/buddy/dreams",
    companion: "/v1/buddy/companion",
    interact: "/v1/buddy/interact",
    stats: "/v1/buddy/stats",
  },
  background: {
    status: "/v1/background/status",
  },
  state: {
    all: "/v1/state/all",
  },
  knowledge: {
    base: "/v1/knowledge",
    byId: (id: string) => `/v1/knowledge/${id}`,
    search: "/v1/knowledge/search",
    doc: "/v1/knowledge/doc",
    bases: "/v1/knowledge/bases",
    baseByName: (name: string) =>
      `/v1/knowledge/bases/${encodeURIComponent(name)}`,
    cloneBase: (name: string) =>
      `/v1/knowledge/bases/${encodeURIComponent(name)}/clone`,
    duplicateBase: (name: string) =>
      `/v1/knowledge/bases/${encodeURIComponent(name)}/duplicate`,
    saveFromChat: "/v1/knowledge/save-from-chat",
    rawFiles: "/v1/knowledge/raw-files",
    docs: "/v1/knowledge/docs",
    upload: "/v1/knowledge/upload",
    compile: "/v1/knowledge/compile",
    compileStatus: "/v1/knowledge/compile-status",
    exportToNotebook: "/v1/knowledge/export-to-notebook",
    importFromFile: "/v1/knowledge/import-from-file",
    batchDelete: "/v1/knowledge/batch-delete",
    batchTag: "/v1/knowledge/batch-tag",
    snapshots: "/v1/knowledge/snapshots",
    restore: "/v1/knowledge/restore",
    health: "/v1/knowledge/health",
    config: "/v1/knowledge/config",
    trash: "/v1/knowledge/trash",
    restoreTrash: "/v1/knowledge/restore-trash",
    semanticIndex: "/v1/knowledge/semantic-index",
    ingest: "/v1/knowledge/ingest",
    datasources: "/v1/knowledge/datasources",
    datasourceByType: (type: string) => `/v1/knowledge/datasources/${type}`,
    datasourceSync: (type: string) => `/v1/knowledge/datasources/${type}/sync`,
    graphEdges: "/v1/knowledge/graph/edges",
    graphStats: "/v1/knowledge/graph/stats",
    faqBase: (base: string) => `/v1/knowledge/${encodeURIComponent(base)}/faq`,
    faqById: (base: string, id: string) =>
      `/v1/knowledge/${encodeURIComponent(base)}/faq/${id}`,
    faqBatchDelete: (base: string) =>
      `/v1/knowledge/${encodeURIComponent(base)}/faq/batch-delete`,
    faqImport: (base: string) =>
      `/v1/knowledge/${encodeURIComponent(base)}/faq/import`,
    faqSearch: (base: string) =>
      `/v1/knowledge/${encodeURIComponent(base)}/faq/search`,
    faqCategories: (base: string) =>
      `/v1/knowledge/${encodeURIComponent(base)}/faq/categories`,
  },
  workspace: {
    base: "/v1/workspaces",
    byId: (id: string) => `/v1/workspaces/${id}`,
    sessions: (workspaceId: string) => `/v1/workspaces/${workspaceId}/sessions`,
    items: (workspaceId: string) => `/v1/workspaces/${workspaceId}/items`,
    itemById: (workspaceId: string, itemId: string) =>
      `/v1/workspaces/${workspaceId}/items/${itemId}`,
    liriDetect: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/liri/detect`,
    liriInit: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/liri/init`,
    config: (workspaceId: string) => `/v1/workspaces/${workspaceId}/config`,
    rules: (workspaceId: string) => `/v1/workspaces/${workspaceId}/rules`,
    ruleBySpec: (workspaceId: string, specialization: string) =>
      `/v1/workspaces/${workspaceId}/rules/${specialization}`,
    rulesLoad: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/rules/load`,
    rulesOverview: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/rules/overview`,
    itemChangeSets: (workspaceId: string, itemId: string) =>
      `/v1/workspaces/${workspaceId}/items/${itemId}/changesets`,
    changeSetById: (workspaceId: string, changesetId: string) =>
      `/v1/workspaces/${workspaceId}/changesets/${changesetId}`,
    changeSetFiles: (workspaceId: string, changesetId: string) =>
      `/v1/workspaces/${workspaceId}/changesets/${changesetId}/files`,
    changeSetSummary: (workspaceId: string, changesetId: string) =>
      `/v1/workspaces/${workspaceId}/changesets/${changesetId}/summary`,
    orchestration: (workspaceId: string, itemId: string) =>
      `/v1/workspaces/${workspaceId}/items/${itemId}/orchestration`,
    swarm: (workspaceId: string) => `/v1/workspaces/${workspaceId}/swarm`,
    agentModelBindings: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/agent-model-bindings`,
    teams: (workspaceId: string) => `/v1/workspaces/${workspaceId}/teams`,
    teamById: (workspaceId: string, teamId: string) =>
      `/v1/workspaces/${workspaceId}/teams/${teamId}`,
    teamMembers: (workspaceId: string, teamId: string) =>
      `/v1/workspaces/${workspaceId}/teams/${teamId}/members`,
    teamMemberById: (workspaceId: string, teamId: string, memberId: string) =>
      `/v1/workspaces/${workspaceId}/teams/${teamId}/members/${memberId}`,
    teamMemberRole: (workspaceId: string, teamId: string, memberId: string) =>
      `/v1/workspaces/${workspaceId}/teams/${teamId}/members/${memberId}/role`,
    costReport: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/cost/report`,
    costBudget: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/cost/budget`,
    itemsSearch: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/items/search`,
    itemsReview: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/items/review`,
    council: (workspaceId: string) => `/v1/workspaces/${workspaceId}/council`,
    councilById: (workspaceId: string, sessionId: string) =>
      `/v1/workspaces/${workspaceId}/council/${sessionId}`,
    intelligenceImpact: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/intelligence/impact`,
    intelligenceRisks: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/intelligence/risks`,
    intelligenceDecision: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/intelligence/decision`,
    intelligenceEscalate: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/intelligence/escalate`,
    intelligenceEscalations: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/intelligence/escalations`,
    intelligenceSchedule: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/intelligence/schedule`,
    intelligenceResources: (workspaceId: string) =>
      `/v1/workspaces/${workspaceId}/intelligence/resources`,
  },
  project: {
    base: "/v1/projects",
    byId: (projectId: string) => `/v1/projects/${projectId}`,
  },
  workflow: {
    templates: "/v1/workflows/templates",
    templateById: (templateId: string) =>
      `/v1/workflows/templates/${templateId}`,
  },
  skill: {
    base: "/v1/skills",
    system: "/v1/skills/system",
    byId: (id: string) => `/v1/skills/${id}`,
    enable: (id: string) => `/v1/skills/${id}/enable`,
    disable: (id: string) => `/v1/skills/${id}/disable`,
    files: (id: string) => `/v1/skills/${id}/files`,
    systemContent: (id: string) =>
      `/v1/skills/system/${encodeURIComponent(id)}/content`,
    systemFileContent: (skillId: string, filePath: string) =>
      `/v1/skills/system/${encodeURIComponent(skillId)}/files/content?path=${encodeURIComponent(filePath)}`,
    categories: "/v1/skills/categories",
    search: "/v1/skills/search",
    install: "/v1/skills/install",
    recommended: "/v1/skills/recommended",
    export: "/v1/skills/export",
    sources: "/v1/skills/sources",
    sourceByName: (name: string) =>
      `/v1/skills/sources/${encodeURIComponent(name)}`,
    import: "/v1/skills/import",
    byIdEncoded: (skillId: string) =>
      `/v1/skills/${encodeURIComponent(skillId)}`,
    uninstall: (skillId: string) =>
      `/v1/skills/${encodeURIComponent(skillId)}/uninstall`,
    updateByIdEncoded: (skillId: string) =>
      `/v1/skills/${encodeURIComponent(skillId)}/update`,
    toggle: (skillId: string) =>
      `/v1/skills/${encodeURIComponent(skillId)}/toggle`,
    clone: (skillId: string) =>
      `/v1/skills/${encodeURIComponent(skillId)}/clone`,
  },
  session: {
    base: "/v1/sessions",
    byId: (id: string) => `/v1/sessions/${id}`,
    meta: (id: string) => `/v1/sessions/${id}/meta`,
    fork: (sourceId: string) => `/v1/sessions/${sourceId}/fork`,
    switchById: (id: string) => `/v1/sessions/${id}/switch`,
    current: "/v1/sessions/current",
    messages: (sessionId: string) => `/v1/sessions/${sessionId}/messages`,
    // B2（2026-10-30）：按轮摘要（绝对轮号）—— 一次请求补齐轮次导航的未加载轮次
    roundSummaries: (sessionId: string) =>
      `/v1/sessions/${sessionId}/round-summaries`,
    messageById: (sessionId: string, messageId: string) =>
      `/v1/sessions/${sessionId}/messages/${messageId}`,
    messagesTruncate: (sessionId: string) =>
      `/v1/sessions/${sessionId}/messages/truncate`,
    messagesSearch: "/v1/sessions/messages/search",
    batchDelete: "/v1/sessions/batch-delete",
    streaming: (sessionId: string) => `/v1/sessions/${sessionId}/streaming`,
    compact: (sessionId: string) => `/v1/sessions/${sessionId}/compact`,
    prune: "/v1/sessions/prune",
    memory: (sessionId: string) => `/v1/sessions/${sessionId}/memory`,
    messagesEncoded: (sessionId: string) =>
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages`,
    messagesTruncateEncoded: (sessionId: string) =>
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages/truncate`,
    resume: (sessionId: string) => `/v1/sessions/${sessionId}/resume`,
    checkpointsLatest: (sessionId: string) =>
      `/v1/sessions/${sessionId}/checkpoints/latest`,
    steer: (sessionId: string) => `/v1/sessions/${sessionId}/steer`,
    events: (sessionId: string) => `/v1/sessions/${sessionId}/events`,
    stats: (sessionId: string) => `/v1/sessions/${sessionId}/stats`,
    eventsExport: (sessionId: string) =>
      `/v1/sessions/${encodeURIComponent(sessionId)}/events/export`,
  },
  usage: {
    summary: "/v1/usage/summary",
    trend: "/v1/usage/trend",
    models: "/v1/usage/models",
    providers: "/v1/usage/providers",
    logs: "/v1/usage/logs",
    costSummary: "/v1/usage/cost/summary",
    costRecords: "/v1/usage/cost/records",
    costRange: "/v1/usage/cost/range",
    costReconcile: "/v1/usage/cost/reconcile",
    costReport: "/v1/usage/cost/report",
    balance: "/v1/usage/balance",
    balances: "/v1/usage/balances",
  },
  pricing: {
    base: "/v1/pricing",
    byId: (modelId: string) => `/v1/pricing/${encodeURIComponent(modelId)}`,
  },
  cost: {
    /** G-04（2026-10-19）：只读成本折算估算器（同源取价链） */
    estimateTurn: "/v1/cost/estimate-turn",
    dailyBudget: "/v1/cost/daily-budget",
    dailyBudgetReset: "/v1/cost/daily-budget/reset",
    dailyBudgetRelief: "/v1/cost/daily-budget/relief",
    dailyBudgetKillSwitch: "/v1/cost/daily-budget/kill-switch",
    /** 只读**挂起清单**（v1.5 A2）—— 供"挂起后回来仍能继续"的入口使用 */
    dailyBudgetSuspend: "/v1/cost/daily-budget/suspend",
  },
  files: {
    registryDelete: "/v1/files/registry/delete",
    convert: "/v1/files/convert",
    detect: "/v1/files/detect",
    registrySearch: "/v1/files/registry/search",
    registryDetail: "/v1/files/registry/detail",
    registryStats: "/v1/files/registry/stats",
    list: "/v1/files/list",
    read: "/v1/files/read",
    sendToAi: "/v1/files/send-to-ai",
    upload: "/v1/files/upload",
  },
  channels: {
    base: "/v1/channels",
    byId: (id: string) => `/v1/channels/${id}`,
    toggle: (id: string) => `/v1/channels/${id}/toggle`,
    health: (id: string) => `/v1/channels/${id}/health`,
    healthAll: "/v1/channels/health",
    metrics: "/v1/channels/metrics",
    monitorStatus: "/v1/channels/monitor/status",
    monitorForceReconnect: "/v1/channels/monitor/force-reconnect",
    messagesTrace: "/v1/channels/messages/trace",
    schema: "/v1/channels/schema",
    configApply: "/v1/channels/config/apply",
    plugins: "/v1/channels/plugins",
    pluginsInstall: "/v1/channels/plugins/install",
  },
  wechat: {
    cliStatus: "/v1/wechat/cli-status",
  },
  providers: {
    base: "/v1/providers",
    byIdEncoded: (id: string) => `/v1/providers/${encodeURIComponent(id)}`,
    toggle: (id: string) => `/v1/providers/${encodeURIComponent(id)}/toggle`,
    test: (id: string) => `/v1/providers/${encodeURIComponent(id)}/test`,
    models: (id: string) => `/v1/providers/${encodeURIComponent(id)}/models`,
    stats: "/v1/providers/stats",
    presets: "/v1/providers/presets",
    status: "/v1/providers/status",
  },
  models: {
    base: "/v1/models",
    bulkImport: "/v1/models/bulk-import",
    capabilities: "/v1/models/capabilities",
    capabilityByKey: (key: string) =>
      `/v1/models/capabilities/${encodeURIComponent(key)}`,
    capabilitiesBatch: "/v1/models/capabilities/batch",
    capabilitiesTaskMappings: "/v1/models/capabilities/task-mappings",
    capabilitiesCategories: "/v1/models/capabilities/categories",
    capabilitiesValidate: "/v1/models/capabilities/validate",
    byId: (id: string) => `/v1/models/${encodeURIComponent(id)}`,
    toggle: (id: string) => `/v1/models/${encodeURIComponent(id)}/toggle`,
    test: "/v1/models/test",
    orphans: "/v1/models/orphans",
    pricingSync: "/v1/models/pricing/sync",
    probe: "/v1/models/probe",
    current: "/v1/models/current",
    switch: "/v1/models/switch",
    tasks: "/v1/models/tasks",
    tasksDefinitions: "/v1/models/tasks/definitions",
    default: "/v1/models/default",
    phaseMapping: "/v1/models/phase-mapping",
  },
  doc: {
    status: "/v1/doc/status",
    download: "/v1/doc/download",
    rename: "/v1/doc/rename",
    delete: "/v1/doc/delete",
    upload: "/v1/doc/upload",
  },
  officecli: {
    status: "/v1/officecli/status",
    install: "/v1/officecli/install",
  },
  mail: {
    status: "/v1/mail/status",
    config: "/v1/mail/config",
    send: "/v1/mail/send",
    inbox: "/v1/mail/inbox",
    sent: "/v1/mail/sent",
    search: "/v1/mail/search",
    byId: (id: string) => `/v1/mail/${id}`,
    read: (id: string) => `/v1/mail/${id}/read`,
  },
  calendar: {
    status: "/v1/calendar/status",
    events: "/v1/calendar/events",
    eventById: (id: string) => `/v1/calendar/events/${id}`,
    exportEvent: (id: string) => `/v1/calendar/export/${id}`,
    merged: "/v1/calendar/merged",
    eventStatus: (id: string) => `/v1/calendar/events/${id}/status`,
    eventsBatchStatus: "/v1/calendar/events/batch-status",
    overdueCheck: "/v1/calendar/overdue-check",
  },
  plans: {
    base: "/v1/plans",
    byIdEncoded: (id: string) => `/v1/plans/${encodeURIComponent(id)}`,
    execute: (id: string) => `/v1/plans/${encodeURIComponent(id)}/execute`,
    abort: (id: string) => `/v1/plans/${encodeURIComponent(id)}/abort`,
    dag: (id: string) => `/v1/plans/${encodeURIComponent(id)}/dag`,
  },
  pdca: {
    list: "/v1/pdca/list",
    byIdEncoded: (id: string) => `/v1/pdca/${encodeURIComponent(id)}`,
    start: "/v1/pdca/start",
  },
  kanban: {
    base: "/v1/kanban",
    byIdEncoded: (id: string) => `/v1/kanban/${encodeURIComponent(id)}`,
    move: (id: string) => `/v1/kanban/${encodeURIComponent(id)}/move`,
  },
  research: {
    start: "/v1/research/start",
  },
  patterns: {
    base: "/v1/patterns",
    export: "/v1/patterns/export",
  },
  voice: {
    settings: "/v1/voice/settings",
    sessionStart: "/v1/voice/session/start",
    sessionEnd: (sessionId: string) => `/v1/voice/session/${sessionId}/end`,
    sessions: "/v1/voice/sessions",
    sessionById: (sessionId: string) => `/v1/voice/session/${sessionId}`,
    upload: "/v1/voice/upload",
    stream: (sessionId: string) => `/v1/voice/stream/${sessionId}`,
    tts: "/v1/voice/tts",
    providers: "/v1/voice/providers",
    voices: "/v1/voice/voices",
    wakeWordTest: (wakeWordId: string) =>
      `/v1/voice/wakeword/${wakeWordId}/test`,
    transcribe: "/v1/voice/transcribe",
    health: "/v1/voice/health",
  },
  settings: {
    voice: "/v1/settings/voice",
    soul: "/v1/settings/soul",
    user: "/v1/settings/user",
    /** P2/P3（2026-10-16）：工具可见性覆写（`{ overrides: { [toolName]: 'on' | 'off' } }`） */
    tools: "/v1/settings/tools",
  },
  tts: {
    providers: "/v1/tts/providers",
    health: "/v1/tts/health",
    providerConfig: (provider: string) =>
      `/v1/tts/providers/${provider}/config`,
  },
  memory: {
    base: "/v1/memory",
    byId: (id: string) => `/v1/memory/${id}`,
    search: "/v1/memory/search",
    summary: (id: string) => `/v1/memory/${id}/summary`,
    weights: "/v1/memory/weights",
    stats: "/v1/memory/stats",
    sync: "/v1/memory/sync",
    consolidate: "/v1/memory/consolidate",
    createFromFile: "/v1/memory/create-from-file",
    dream: "/v1/memory/dream",
    dreamCycles: "/v1/memory/dream/cycles",
    dreamCycle: (cycleId: string) => `/v1/memory/dream/cycles/${cycleId}`,
  },
  monitor: {
    metrics: "/v1/monitor/metrics",
    summary: "/v1/monitor/summary",
    alerts: "/v1/monitor/alerts",
    acknowledgeAlert: (id: string) => `/v1/monitor/alerts/${id}/acknowledge`,
    logs: "/v1/monitor/logs",
    sessions: "/v1/monitor/sessions",
    sessionDetail: (sessionId: string) => `/v1/monitor/sessions/${sessionId}`,
    logsExport: "/v1/monitor/logs/export",
  },
  health: {
    report: "/v1/health/report",
  },
  analytics: {
    dashboard: "/v1/analytics/dashboard",
  },
  llama: {
    status: "/v1/llama/status",
    config: "/v1/llama/config",
    restart: "/v1/llama/restart",
    forceKill: "/v1/llama/force-kill",
    forceRestart: "/v1/llama/force-restart",
    logs: "/v1/llama/logs",
    logsStream: "/v1/llama/logs/stream",
    hardware: "/v1/llama/hardware",
    recommendations: "/v1/llama/recommendations",
    modelByFilename: (filename: string) =>
      `/v1/llama/models/${encodeURIComponent(filename)}`,
    migrate: "/v1/llama/migrate",
    migrateCancel: "/v1/llama/migrate/cancel",
    download: "/v1/llama/download",
  },
  goals: {
    base: "/v1/goals",
    byId: (id: string) => `/v1/goals/${encodeURIComponent(id)}`,
  },
  chat: {
    completions: "/v1/chat/completions",
    questionAnswer: "/v1/chat/question-answer",
  },
  // 后端命令（2026-10-22：会话级命令如 brief 需要 session_id，见 commands-handlers）
  commands: {
    list: "/v1/commands",
    execute: "/v1/commands/execute",
  },
  config: {
    base: "/v1/config",
    reload: "/v1/config/reload",
    byKey: (key: string) => `/v1/config/${key}`,
    modelOverride: (modelId: string) =>
      `/v1/config/models.overrides.${encodeURIComponent(modelId)}`,
    modelOverrideKey: (modelId: string, key: string) =>
      `/v1/config/models.overrides.${encodeURIComponent(modelId)}.${key}`,
  },
  images: {
    list: "/v1/images/list",
    static: (relPath: string) => `/v1/images/static/${relPath}`,
    staticPrefix: "/v1/images/static/",
    delete: "/v1/images/delete",
    upload: "/v1/images/upload",
  },
  infrastructure: {
    status: "/v1/infrastructure/status",
  },
  mcp: {
    marketplaceSearch: "/v1/mcp/marketplace/search",
    marketplaceCategories: "/v1/mcp/marketplace/categories",
    marketplaceInstalled: "/v1/mcp/marketplace/installed",
    marketplaceRegistries: "/v1/mcp/marketplace/registries",
    marketplaceServer: (serverId: string) =>
      `/v1/mcp/marketplace/servers/${encodeURIComponent(serverId)}`,
    marketplaceServerInstall: (serverId: string) =>
      `/v1/mcp/marketplace/servers/${encodeURIComponent(serverId)}/install`,
    marketplaceServerUninstall: (serverId: string) =>
      `/v1/mcp/marketplace/servers/${encodeURIComponent(serverId)}/uninstall`,
    marketplaceServerToggle: (serverId: string) =>
      `/v1/mcp/marketplace/servers/${encodeURIComponent(serverId)}/toggle`,
    serverVerify: (serverId: string) =>
      `/v1/mcp/servers/${encodeURIComponent(serverId)}/verify`,
    tools: "/v1/mcp/tools",
    toolToggle: (toolName: string) =>
      `/v1/mcp/tools/${encodeURIComponent(toolName)}/toggle`,
  },
  notifications: {
    base: "/v1/notifications",
    unreadCount: "/v1/notifications/unread-count",
    readAll: "/v1/notifications/read-all",
    byId: (id: string) => `/v1/notifications/${id}`,
    markRead: (id: string) => `/v1/notifications/${id}/read`,
    dismiss: (id: string) => `/v1/notifications/${id}/dismiss`,
  },
  permissions: {
    rules: "/v1/permissions/rules",
    ruleById: (ruleId: string) => `/v1/permissions/rules/${ruleId}`,
    roles: "/v1/permissions/roles",
    users: "/v1/permissions/users",
    userById: (userId: string) => `/v1/permissions/users/${userId}`,
    resources: "/v1/permissions/resources",
  },
  plugins: {
    marketplaceSearch: "/v1/plugins/marketplace/search",
    marketplaceCategories: "/v1/plugins/marketplace/categories",
    marketplaceInstalled: "/v1/plugins/marketplace/installed",
    marketplacePending: "/v1/plugins/marketplace/pending",
    marketplacePlugin: (pluginId: string) =>
      `/v1/plugins/marketplace/plugins/${encodeURIComponent(pluginId)}`,
    marketplacePluginInstall: (pluginId: string) =>
      `/v1/plugins/marketplace/plugins/${encodeURIComponent(pluginId)}/install`,
    marketplacePluginUninstall: (pluginId: string) =>
      `/v1/plugins/marketplace/plugins/${encodeURIComponent(pluginId)}/uninstall`,
    /** T25-08 P2：能力状态（GET）/ 勾选授权（PUT）共用同一路径 */
    marketplacePluginCapabilities: (pluginId: string) =>
      `/v1/plugins/marketplace/plugins/${encodeURIComponent(pluginId)}/capabilities`,
  },
  router: {
    config: "/v1/router/config",
  },
  sandbox: {
    config: "/v1/sandbox/config",
    status: "/v1/sandbox/status",
  },
  semantic: {
    index: "/v1/semantic/index",
    indexStatus: "/v1/semantic/index/status",
    indexTask: "/v1/semantic/index/task",
    search: "/v1/semantic/search",
  },
  system: {
    exec: "/v1/system/exec",
    estop: "/v1/system/estop",
    sleepResolve: "/v1/system/sleep/resolve",
  },
  tasks: {
    base: "/v1/tasks",
    byId: (taskId: string) => `/v1/tasks/${encodeURIComponent(taskId)}`,
    children: (taskId: string) =>
      `/v1/tasks/${encodeURIComponent(taskId)}/children`,
  },
  tools: {
    base: "/v1/tools",
    execute: (toolName: string) => `/v1/tools/${toolName}/execute`,
    /** P1（2026-10-16）：工具**可见性报表**（只读；解释"为什么模型看不见它"） */
    visibility: "/v1/tools/visibility",
  },
  trace: {
    stats: "/v1/trace/stats",
  },
  translate: {
    base: "/v1/translate",
    stream: "/v1/translate/stream",
    history: "/v1/translate/history",
    historyStar: (id: string) => `/v1/translate/history/${id}/star`,
    historyDelete: "/v1/translate/history/delete",
    historyExport: "/v1/translate/history/export",
    alternatives: "/v1/translate/alternatives",
  },
  vfs: {
    mounts: "/v1/vfs/mounts",
  },
  videos: {
    list: "/v1/videos/list",
    delete: "/v1/videos/delete",
  },
  video: {
    tasks: "/v1/video/tasks",
    task: (taskId: string) => `/v1/video/tasks/${encodeURIComponent(taskId)}`,
    taskCancel: (taskId: string) =>
      `/v1/video/tasks/${encodeURIComponent(taskId)}/cancel`,
  },
} as const;
