// 自动生成的分版 Feature Flags
// 变体: full — 全量版（发版单档，2026-09-10）— 全部档位功能并集，构建期不裁剪；版本分层由运行时 tier 控制
// 生成时间: 2026-09-10T01:27:49.961Z

export const BUILD_VARIANT_FLAGS = {
  BASH: true,
  FILE_READ: true,
  FILE_WRITE: true,
  FILE_EDIT: true,
  GREP: true,
  GLOB: true,
  WEB_FETCH: true,
  WEB_SEARCH: true,
  TASK: true,
  TODO: true,
  ASK: true,
  AGENT: true,
  ENABLE_PLUGINS: true,
  ENABLE_SKILLS: true,
  MCP_SYSTEM: true,
  FILE_CONVERTER: true,
  PLAN: true,
  BRIEF: true,
  CHRONOS: true,
  TUNGSTEN: true,
  AGENT_SWARMS: true,
  LSP: true,
  NOTEBOOK: true,
  CODE_ANALYSIS: true,
  BROWSER: true,
  TEAM_CREATE: true,
  TEAM_DELETE: true,
  AGENT_TRIGGERS: true,
  SEND_MESSAGE: true,
  COORDINATOR_MODE: true,
  DOC_MODULE: true,
  DOC_TEMPLATE: true,
  MAIL_MODULE: true,
  CALENDAR_MODULE: true,
} as const;

export const DEFAULT_BUILD_VARIANT = 'full' as const;
