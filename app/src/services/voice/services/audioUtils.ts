/**
 * 音频工具函数
 *
 * 提供 PCM 数据处理、采样率转换等通用音频工具。
 * 从 voiceService.ts 提取以减小上帝对象耦合。
 */

/** 对象池：复用 pcm16BufferToSamples 的 Float64Array 缓冲区 */
let samplesBuffer: Float64Array | null = null;

/**
 * 将 PCM Int16 Buffer 转换为归一化 Float64Array
 * 复用内部缓冲区减少 GC 压力
 *
 * @param buffer PCM Int16 音频数据
 * @returns 归一化到 [-1, 1] 范围的 Float64Array
 */
export function pcm16BufferToSamples(buffer: Buffer): Float64Array {
  const len = buffer.length / 2;
  if (!samplesBuffer || samplesBuffer.length !== len) {
    samplesBuffer = new Float64Array(len);
  }
  for (let i = 0; i < len; i++) {
    samplesBuffer[i] = buffer.readInt16LE(i * 2) / 32768;
  }
  return samplesBuffer;
}
