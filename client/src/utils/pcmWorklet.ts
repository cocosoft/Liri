/**
 * AudioWorklet PCM16 采集处理器（语音系统升级 3.1 / P2-10 推荐项）
 *
 * 用 AudioWorklet（独立线程）将麦克风输入转成 16-bit PCM 原始字节，
 * 通过 port.postMessage 回传主线程，避免 ScriptProcessorNode 的主线程压力。
 * 处理器以 Blob URL 加载，无需构建配置改动；运行环境不支持时返回 null，
 * 调用方降级到 ScriptProcessorNode。
 *
 * 处理器逻辑与 VoiceInputButton 中 ScriptProcessorNode 的转换一致
 * （clamp [-1,1] → Int16），保证两路采集产物完全等价。
 */

/** AudioWorklet 处理器注册名 */
const PROCESSOR_NAME = "pcm16-processor";

/** 处理器源码（AudioWorklet 全局作用域，无法 import 外部模块） */
const WORKLET_SOURCE = `
class Pcm16Processor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const channel = input[0];
      const pcm = new Int16Array(channel.length);
      for (let i = 0; i < channel.length; i++) {
        const s = Math.max(-1, Math.min(1, channel[i]));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor('${PROCESSOR_NAME}', Pcm16Processor);
`;

/** 处理器模块 URL（懒加载缓存，避免重复创建 Blob） */
let cachedUrl: string | null = null;

/**
 * 获取 AudioWorklet 处理器模块 URL（Blob URL）
 * @returns 模块 URL；当前环境不支持 AudioWorklet 时返回 null
 */
export function getPcmWorkletUrl(): string | null {
  if (typeof AudioWorkletNode === "undefined") return null;
  if (!cachedUrl) {
    cachedUrl = URL.createObjectURL(
      new Blob([WORKLET_SOURCE], { type: "application/javascript" }),
    );
  }
  return cachedUrl;
}

/** 处理器注册名（供 AudioWorkletNode 构造使用） */
export const PCM_WORKLET_PROCESSOR = PROCESSOR_NAME;
