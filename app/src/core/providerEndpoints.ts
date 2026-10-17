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
