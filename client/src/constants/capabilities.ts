/**
 * 模型**能力键**前端单一事实源（硬编码统一治理方案 §4.2 **B3** / §7.2 `HD-P0-3`）。
 *
 * **为什么是"契约 + 同值测试"而不是"合成一处"**：后端（`app/`）与前端（`client/`）是
 * **两个部署单元**，物理上无法共享同一模块 ⇒ 治理方式是
 * **①前端收口一处（本文件）+ ②契约测试比对两侧取值**。
 *
 * 后端**规范集合**的真源 = `app/src/ai/config/capabilities.default.yaml` 的
 * `capabilities[].key`（该文件同版本随 `applyOfficial...` 入 DB 播种）。
 * `app/tests/contracts/crossDeploymentContract.test.ts` 的 **B3** 用例断言
 * **本文件的每个键 ⊆ 后端规范集合**（防前端写了后端不存在的能力键 ⇒ 静默失效）。
 *
 * ⚠️ 前端这份列表是 **UI 退化清单**（后端 `GET /v1/models/capabilities` 不可用时兜底），
 * 是后端规范集合的**子集**（有意不追平 28 键 —— 只列 UI 需要呈现的项）；
 * 契约的判据是 **⊆**，不是 **=**。
 */
export const CAPABILITY = {
  streaming: "streaming",
  function_calling: "function_calling",
  tool_use: "tool_use",
  vision: "vision",
  image_input: "image_input",
  image_generation: "image_generation",
  video_generation: "video_generation",
  text_to_speech: "text_to_speech",
  speech_recognition: "speech_recognition",
  embedding: "embedding",
  structured_output: "structured_output",
  thinking: "thinking",
} as const;

export type CapabilityKey = (typeof CAPABILITY)[keyof typeof CAPABILITY];

/** 前端用到的全部能力键（供契约测试比对；= `CAPABILITY` 的值集） */
export const CAPABILITY_KEYS: readonly CapabilityKey[] =
  Object.values(CAPABILITY);
