/**
 * `deriveModelType`：能力 → 类型推导（台账 N-40 回归）
 *
 * 该函数是**单一实现**，同时供 ① `/v1/models` 投影（`ModelRuntimeAPI`）与
 * ② Agent 角色模型校验（`agent-role-handlers`）使用 —— 两处必须同口径。
 *
 * **N-40**：原实现只认 `VIDEO_GENERATION`，未映射 `TEXT_TO_VIDEO` / `IMAGE_TO_VIDEO` /
 * `IMAGE_EDITING` ⇒ 只带这些能力的模型被投影为 `chat`。
 * 影响不止"选择器多列几个模型"：`MediaPage` 以 `m.type === 'video' | 'image'` 做
 * **能力门控**（判断"是否已启用生视频/生图模型"）⇒ 漏映射会造成媒体页功能误判。
 */
import { describe, test, expect } from 'bun:test';
import { deriveModelType, ModelCapability } from '../../src/ai/models/types';

describe('deriveModelType：生成类能力全覆盖（N-40）', () => {
  test('仅带 `text_to_video` ⇒ video（修复前为 chat）', () => {
    expect(deriveModelType([ModelCapability.TEXT_TO_VIDEO])).toBe('video');
  });

  test('仅带 `image_to_video` ⇒ video（修复前为 chat）', () => {
    expect(deriveModelType([ModelCapability.IMAGE_TO_VIDEO])).toBe('video');
  });

  test('仅带 `image_editing` ⇒ image（修复前为 chat）', () => {
    expect(deriveModelType([ModelCapability.IMAGE_EDITING])).toBe('image');
  });

  test('同带图像与视频能力时按 image 判定（判定顺序稳定）', () => {
    expect(
      deriveModelType([
        ModelCapability.IMAGE_GENERATION,
        ModelCapability.TEXT_TO_VIDEO,
      ])
    ).toBe('image');
  });
});

describe('deriveModelType：既有映射不回归 + 输入类能力不误判', () => {
  test('原有映射逐项保持', () => {
    expect(deriveModelType([ModelCapability.IMAGE_GENERATION])).toBe('image');
    expect(deriveModelType([ModelCapability.VIDEO_GENERATION])).toBe('video');
    expect(deriveModelType([ModelCapability.RERANKING])).toBe('reranking');
    expect(deriveModelType([ModelCapability.EMBEDDING])).toBe('embedding');
    expect(deriveModelType([ModelCapability.TEXT_TO_SPEECH])).toBe('voice');
    expect(deriveModelType([ModelCapability.SPEECH_RECOGNITION])).toBe('voice');
    expect(deriveModelType([])).toBe('chat');
  });

  test('多模态**输入**类能力不参与类型判定（仍是对话模型）', () => {
    expect(
      deriveModelType([
        ModelCapability.IMAGE_INPUT,
        ModelCapability.AUDIO_INPUT,
        ModelCapability.VIDEO_INPUT,
        ModelCapability.PDF_INPUT,
        ModelCapability.VISION,
      ])
    ).toBe('chat');
  });
});
