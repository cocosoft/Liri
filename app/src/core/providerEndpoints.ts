/**
 * 官方供应商 API 端点真源（U-20/B5-2-98）。
 *
 * 边界：本文件只承载**第三方厂商的固定 API 基址**；本机端点见 `core/endpoints.ts`，
 * 供应商预设清单见 `ai/providers/providerPresetsData.ts`（引用本文件，不再重复字面量）。
 *
 * 置于 core：`channels` / `services` / `plugins` / `plugin-sdk` 都要用，
 * 放在 `ai`（app 层）会造成 `service → app` 分层倒挂（R00-001）。
 */
export const OPENAI_API_BASE_URL = 'https://api.openai.com';
export const OPENAI_API_V1_BASE_URL = `${OPENAI_API_BASE_URL}/v1`;

export const ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_API_V1_BASE_URL = `${ANTHROPIC_API_BASE_URL}/v1`;

export const DEEPSEEK_API_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_API_V1_BASE_URL = `${DEEPSEEK_API_BASE_URL}/v1`;

export const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com';
export const GEMINI_API_V1BETA_BASE_URL = `${GEMINI_API_BASE_URL}/v1beta`;

export const SILICONFLOW_API_BASE_URL = 'https://api.siliconflow.cn';
export const SILICONFLOW_API_V1_BASE_URL = `${SILICONFLOW_API_BASE_URL}/v1`;

export const MOONSHOT_API_BASE_URL = 'https://api.moonshot.cn';
export const MOONSHOT_API_V1_BASE_URL = `${MOONSHOT_API_BASE_URL}/v1`;

export const XAI_API_BASE_URL = 'https://api.x.ai';
export const XAI_API_V1_BASE_URL = `${XAI_API_BASE_URL}/v1`;

export const OPENROUTER_API_BASE_URL = 'https://openrouter.ai';
export const OPENROUTER_API_V1_BASE_URL = `${OPENROUTER_API_BASE_URL}/api/v1`;

export const BIGMODEL_API_BASE_URL = 'https://open.bigmodel.cn';
export const BIGMODEL_API_V4_BASE_URL = `${BIGMODEL_API_BASE_URL}/api/paas/v4`;

export const DASHSCOPE_API_BASE_URL = 'https://dashscope.aliyuncs.com';
export const DASHSCOPE_COMPATIBLE_V1_BASE_URL = `${DASHSCOPE_API_BASE_URL}/compatible-mode/v1`;

export const KLING_API_BASE_URL = 'https://api.klingai.com';

export const MINIMAX_API_BASE_URL = 'https://api.minimaxi.com';
export const MINIMAX_API_V1_BASE_URL = `${MINIMAX_API_BASE_URL}/v1`;

export const VOLCENGINE_ARK_API_BASE_URL = 'https://ark.cn-beijing.volces.com';
export const VOLCENGINE_ARK_V3_BASE_URL = `${VOLCENGINE_ARK_API_BASE_URL}/api/v3`;

export const VIDU_API_BASE_URL = 'https://api.vidu.cn';

/** 厂商站点（注册 / 取密钥页，非 API 连接目标） */
export const OPENAI_PLATFORM_URL = 'https://platform.openai.com';
export const ANTHROPIC_CONSOLE_URL = 'https://console.anthropic.com';
export const GOOGLE_AI_DEV_URL = 'https://ai.google.dev';
export const GOOGLE_AI_STUDIO_URL = 'https://aistudio.google.com';
