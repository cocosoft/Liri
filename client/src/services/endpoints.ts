/**
 * 前端契约路径（`/v1/*`）**按域**收口 —— 硬编码治理 `HD-P2-4`。
 *
 * **值逐字不变**（含模板插值位置）；本文件是这些路径的**唯一编辑点**。
 * 约定：无参路径用**字符串常量**，含参路径用**构造器函数**。
 */
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
    dailyBudget: "/v1/cost/daily-budget",
    dailyBudgetReset: "/v1/cost/daily-budget/reset",
    dailyBudgetRelief: "/v1/cost/daily-budget/relief",
    dailyBudgetKillSwitch: "/v1/cost/daily-budget/kill-switch",
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
} as const;
