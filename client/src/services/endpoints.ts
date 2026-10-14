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
} as const;
