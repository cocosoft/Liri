/**
 * 本地模型服务探测（G1，2026-11-14）
 *
 * 目的：把「首次配置」从"必须先申请云端 API Key"降为"开箱即用"——
 * 本机已在运行 Ollama / LM Studio / LocalAI 时，onboard 直接提供「一键接入（免 Key）」。
 *
 * 事实源（不新建第二套探测）：
 *  - 端点候选：kernel 的 `LOCAL_INFERENCE_ENDPOINTS`（与供应商预设 `providerPresetsData` 同源）
 *  - 模型列表：`ModelFetcher.fetchModels`（本地类型免 API Key，且已含 `/v1` 拼接规则）
 *
 * 本模块**只读探测**：不写 DB、不注册 provider、不落盘。
 */
import { LOCAL_INFERENCE_ENDPOINTS } from '@openliri/kernel';
import { fetchModels } from '../providers/ModelFetcher.js';
import { LOCAL_SERVICE_DETECT_TIMEOUT_MS } from './defaults.js';

/** 本地服务种类（与 `ModelFetcher.isLocalProvider` 口径一致） */
export type LocalServiceKind = 'ollama' | 'lmstudio' | 'localai';

/**
 * 探测规格。
 * `providerType` 是**写进 providers 表**的类型：LM Studio / LocalAI 与预设一致走 `custom`
 * （`ProviderType` 联合里没有 `lmstudio`/`localai`，不要臆造新类型）。
 */
export interface LocalServiceSpec {
  kind: LocalServiceKind;
  displayName: string;
  providerType: 'ollama' | 'custom';
  candidates: readonly string[];
}

/** 探测结果（仅含模型数 > 0 的服务） */
export interface DetectedLocalService {
  kind: LocalServiceKind;
  displayName: string;
  providerType: 'ollama' | 'custom';
  /** 命中的 baseUrl（已去尾斜杠） */
  baseUrl: string;
  models: string[];
}

/** 每个服务保留本机名与 loopback 两种候选（顺序即优先级） */
export const LOCAL_SERVICE_SPECS: readonly LocalServiceSpec[] = [
  {
    kind: 'ollama',
    displayName: 'Ollama',
    providerType: 'ollama',
    candidates: [
      LOCAL_INFERENCE_ENDPOINTS.ollama.hostname,
      LOCAL_INFERENCE_ENDPOINTS.ollama.loopback,
    ],
  },
  {
    kind: 'lmstudio',
    displayName: 'LM Studio',
    providerType: 'custom',
    candidates: [
      LOCAL_INFERENCE_ENDPOINTS.lmStudio.hostname,
      LOCAL_INFERENCE_ENDPOINTS.lmStudio.loopback,
    ],
  },
  {
    kind: 'localai',
    displayName: 'LocalAI',
    providerType: 'custom',
    candidates: [
      LOCAL_INFERENCE_ENDPOINTS.localAI.hostname,
      LOCAL_INFERENCE_ENDPOINTS.localAI.loopback,
    ],
  },
];

/**
 * 探测本机所有本地模型服务（并发、只读）。
 * @returns 仅返回**可达且至少有一个模型**的服务；顺序与 `LOCAL_SERVICE_SPECS` 一致
 */
export async function detectLocalModelServices(
  timeoutMs: number = LOCAL_SERVICE_DETECT_TIMEOUT_MS
): Promise<DetectedLocalService[]> {
  const probed = await Promise.all(
    LOCAL_SERVICE_SPECS.map((spec) => probeService(spec, timeoutMs))
  );
  return probed.filter((s): s is DetectedLocalService => s !== null);
}

async function probeService(
  spec: LocalServiceSpec,
  timeoutMs: number
): Promise<DetectedLocalService | null> {
  const tried = new Set<string>();
  for (const candidate of spec.candidates) {
    const baseUrl = candidate.replace(/\/+$/, '');
    if (tried.has(baseUrl)) continue;
    tried.add(baseUrl);

    const models = await withTimeout(
      fetchModels(baseUrl, '', undefined, spec.kind),
      timeoutMs,
      []
    );
    if (models.length > 0) {
      return {
        kind: spec.kind,
        displayName: spec.displayName,
        providerType: spec.providerType,
        baseUrl,
        models,
      };
    }
  }
  return null;
}

/** 超时即当作「无模型」，避免探测拖住 onboard */
function withTimeout(
  result: Promise<{ models: Array<{ id: string }> } | { error: string }>,
  timeoutMs: number,
  fallback: string[]
): Promise<string[]> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    result.then(
      (value) => {
        clearTimeout(timer);
        resolve('models' in value ? value.models.map((m) => m.id) : fallback);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}
