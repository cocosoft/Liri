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
 * ReferenceValidator —— 引用型字段归属校验（配置层叠 1.3 ②，数出同源）
 *
 * 依据配置归属矩阵：provider/model/API Key 实体的唯一事实来源是 app.db，
 * 层叠文件只能引用 id（providerId / modelId / defaultModel 等），禁止重新定义。
 * 校验：层叠配置中声明的引用型字段必须能解析到 DB registry 实体，否则 fail-fast
 * （同时解决静默失效，并保证层叠文件不制造 DB 没有的实体）。
 *
 * 设计：注入式校验函数（由调用方/ConfigLayers 注入 ProviderRegistry / ModelRegistry
 * 查询能力），本模块保持纯逻辑可单测。
 */

export interface ReferenceCheckers {
  /** 校验 providerId 是否存在（如 providerRegistry.has(id)） */
  providerExists: (id: string) => boolean | Promise<boolean>;
  /** 校验 modelId 是否存在（如 providerRegistry.getByModel(model) 可解析） */
  modelExists: (model: string) => boolean | Promise<boolean>;
}

export interface ReferenceViolation {
  path: string;
  field: 'providerId' | 'modelId' | 'provider' | 'model';
  value: string;
}

export interface ReferenceValidationResult {
  ok: boolean;
  violations: ReferenceViolation[];
}

/** 识别为「引用型字段」的叶子 key 名 → 校验器类型 */
const REFERENCE_KEYS: Record<
  string,
  'providerId' | 'modelId' | 'provider' | 'model'
> = {
  providerId: 'providerId',
  modelId: 'modelId',
  provider: 'provider',
  model: 'model',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 递归扫描配置，收集所有引用型字段（叶子 key 匹配 REFERENCE_KEYS 且值为字符串）。
 */
function collectReferences(
  node: Record<string, unknown>,
  prefix: string,
  out: Array<{
    path: string;
    field: ReferenceViolation['field'];
    value: string;
  }>
): void {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const refType = REFERENCE_KEYS[key];
    if (refType && typeof value === 'string' && value.length > 0) {
      out.push({ path, field: refType, value });
    } else if (isPlainObject(value)) {
      collectReferences(value, path, out);
    }
  }
}

/**
 * 校验配置中所有引用型字段指向的实体在 registry 中存在。
 *
 * @param config 合并后的配置（或单层 Profile/Bundle 配置）
 * @param checkers 注入的 registry 查询能力
 * @returns 校验结果（violations 非空时调用方应 fail-fast）
 */
export async function validateReferences(
  config: Record<string, unknown>,
  checkers: ReferenceCheckers
): Promise<ReferenceValidationResult> {
  const refs: Array<{
    path: string;
    field: ReferenceViolation['field'];
    value: string;
  }> = [];
  collectReferences(config, '', refs);

  const violations: ReferenceViolation[] = [];
  for (const ref of refs) {
    let exists: boolean;
    try {
      if (ref.field === 'providerId' || ref.field === 'provider') {
        exists = await checkers.providerExists(ref.value);
      } else {
        exists = await checkers.modelExists(ref.value);
      }
    } catch {
      exists = false;
    }
    if (!exists) {
      violations.push({ path: ref.path, field: ref.field, value: ref.value });
    }
  }

  return { ok: violations.length === 0, violations };
}
