// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * MemoryVectorizer — 记忆向量化服务
 *
 * 真实 embedding 优先，不可用时回退确定性伪向量：
 *   - 真实：globalEmbeddingManager.embedOne()（语义向量，如 nomic-embed-text）
 *   - 回退：simpleHash + LCG 生成 64 维确定性向量（无 embedding 服务时的降级）
 *
 * （对标报告 L3 短板补齐：伪向量 → 真实 embedding，主检索路径
 *   memory/retrievers/MemoryRetriever 已用真实 embedding，此处为
 *   agent/memory 遗留模块提供一致能力。）
 */

import { globalEmbeddingManager } from '@modules/ai';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('agent:memory:vectorizer');

/** 伪向量维度（确定性 hash 向量，回退用） */
export const PSEUDO_VECTOR_DIM = 64;

/**
 * 将文本转为向量：真实 embedding 优先，不可用/失败时回退伪向量。
 * 先 isAvailable() 预检，避免无 provider 时 embedOne 挂起。
 * @param text 文本
 * @returns 向量（真实 embedding 或 64 维伪向量）
 */
export async function embedText(text: string): Promise<number[]> {
  try {
    if (await globalEmbeddingManager.isAvailable()) {
      return await globalEmbeddingManager.embedOne(text);
    }
  } catch (error) {
    logger.warn('真实 embedding 不可用，回退确定性伪向量', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return pseudoVector(text);
}

/**
 * 生成确定性伪向量（simpleHash + LCG，64 维）。
 * 相似文本的伪向量不相关——仅供无 embedding 服务时降级使用。
 */
export function pseudoVector(text: string): number[] {
  const hash = simpleHash(text);
  const vector: number[] = [];
  let seed = hash;

  for (let i = 0; i < PSEUDO_VECTOR_DIM; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    vector.push((seed % 1000) / 1000);
  }

  return vector;
}

/**
 * 判断向量是否为伪向量（按维度区分，真实 embedding 维度通常 ≠ 64）。
 */
export function isPseudoVector(vector: number[]): boolean {
  return vector.length === PSEUDO_VECTOR_DIM;
}

/** 确定性字符串 hash（FNV-1a 风格） */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
