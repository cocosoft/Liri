// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * `resolveProbeDurationSeconds` —— 视频元信息时长解析（2026-10-31，P0 功能缺口）。
 *
 * 背景：`GET /v1/videos/metadata` 的 `duration` 此前硬编码 `null`（`TODO: 需要 ffprobe`），
 * 而既有 `ffmpegWrapper.probe()`（15s 超时、ffprobe JSON）早已可用并被 `VideoProcessor` 使用。
 *
 * 口径（如实）：
 * - ffprobe 把 `format.duration` 输出为**字符串**（`"12.345000"`）⇒ 数值/字符串两型都接；
 * - 缺失 / `N/A` / 非有限数 / ≤0 ⇒ `null`（**不伪造 0**）；
 * - ffprobe 不可用/超时 ⇒ `probe()` 返回 `null` ⇒ 同样 `null`（响应体带 `durationUnavailable:true`）。
 */
import { describe, expect, it } from 'bun:test';
import { resolveProbeDurationSeconds } from '../../src/infrastructure/http/handlers/video-handlers';

function probeOf(
  format: Record<string, unknown>
): Parameters<typeof resolveProbeDurationSeconds>[0] {
  return {
    streams: [],
    format,
  } as unknown as Parameters<typeof resolveProbeDurationSeconds>[0];
}

describe('resolveProbeDurationSeconds', () => {
  it('ffprobe 字符串形态（真机实际输出）⇒ 解析为秒', () => {
    expect(
      resolveProbeDurationSeconds(probeOf({ duration: '12.345000' }))
    ).toBe(12.345);
  });

  it('数值形态 ⇒ 原样返回', () => {
    expect(resolveProbeDurationSeconds(probeOf({ duration: 5 }))).toBe(5);
  });

  it('format 缺 duration ⇒ 回落视频流 duration', () => {
    const probe = {
      streams: [
        { codec_type: 'audio', duration: '99' },
        { codec_type: 'video', duration: '7.5' },
      ],
      format: {},
    } as unknown as Parameters<typeof resolveProbeDurationSeconds>[0];
    expect(resolveProbeDurationSeconds(probe)).toBe(7.5);
  });

  it('无效值（`N/A` / 0 / 缺失 / probe 为 null）⇒ null（不伪造 0）', () => {
    expect(
      resolveProbeDurationSeconds(probeOf({ duration: 'N/A' }))
    ).toBeNull();
    expect(resolveProbeDurationSeconds(probeOf({ duration: 0 }))).toBeNull();
    expect(resolveProbeDurationSeconds(probeOf({}))).toBeNull();
    expect(resolveProbeDurationSeconds(null)).toBeNull();
  });
});
