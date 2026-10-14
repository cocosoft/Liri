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
} as const;
