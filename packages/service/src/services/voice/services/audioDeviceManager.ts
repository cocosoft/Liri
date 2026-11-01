/**
 * AudioDeviceManager
 * 音频设备选择管理
 *
 * 枚举系统音频输出/输入设备，提供设备选择接口和配置持久化。
 * 跨平台支持：Windows (PowerShell)、macOS (system_profiler)、Linux (pactl)
 *
 * 参考产品: codex-main tui/src/audio_device.rs
 *
 * P3（2026-08-09）：AudioDeviceManager 类为死代码（全库无消费者）已删除，
 * 仅保留被 audioPlayer 与 voice 桶引用的设备类型定义。
 */

/** 音频设备信息 */
export interface AudioDevice {
  id: string;
  name: string;
  type: 'playback' | 'capture';
  isDefault: boolean;
  isSystemDefault: boolean;
}

/** 音频设备配置持久化结构 */
export interface AudioDeviceConfig {
  preferredPlaybackDevice?: string;
  preferredCaptureDevice?: string;
}
