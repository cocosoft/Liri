/**
 * 音频 MIME 类型工具（语音系统升级 3.1 / P0-1）
 *
 * 从 STTTestPage 抽取为共享 util：浏览器 MediaRecorder 录音格式因平台而异
 * （Chromium=webm、Firefox=ogg、macOS WKWebView=mp4），硬编码 audio/webm
 * 在不受支持环境会抛 NotSupportedError。统一探测避免录音起不来。
 */

/** 按优先级探测浏览器支持的录音 MIME type，都不支持时返回空串（由 MediaRecorder 自行决定） */
export function getSupportedMimeType(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/mp4;codecs=mp4a.40.2",
  ];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

/**
 * 获取录音 Blob 的 MIME type（供上传时后端格式嗅探使用）
 * 优先返回探测到的格式；探测为空时回退 webm。
 */
export function getRecordedBlobType(): string {
  return getSupportedMimeType() || "audio/webm";
}
