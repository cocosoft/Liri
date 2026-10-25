/**
 * 插件配置项的**展示视图**与**写入校验**（纯函数，无 IO）。
 *
 * 实现唯一性（CS01）：schema 与校验逻辑都在 `pluginConfigSchema.ts`；本文件只做两件事：
 * ① 把「清单 schema + 已存储值」拼成 UI / CLI 可直接渲染的视图；
 * ② 对一次 patch 做「键存在性 + 类型 / 必填 / 范围」校验，返回真正要落盘的键值。
 *
 * 存储唯一事实源是 `PluginConfigManager`（`~/.pyapp/plugins/config/config.json`）——
 * 本文件不读文件、不建第二份存储。
 *
 * 调用方：HTTP `GET/PUT /v1/plugins/marketplace/plugins/:id/config` 与 CLI `plugin-settings`。
 */
import type { ConfigItem, PluginConfigSchema } from './pluginConfigSchema';
import { mergeWithDefaults, validatePluginConfig } from './pluginConfigSchema';

/** 单个配置项视图（UI 渲染 + CLI 展示共用） */
export interface PluginConfigItemView {
  key: string;
  type: ConfigItem['type'];
  label: string;
  description?: string;
  required: boolean;
  default?: unknown;
  options?: ConfigItem['options'];
  /** 当前生效值：已存储优先，否则 schema 默认（都没有 ⇒ undefined） */
  value: unknown;
  /** 是否被显式写入过（区别于"只是默认值"） */
  isSet: boolean;
}

/** 某个插件的配置视图 */
export interface PluginConfigView {
  pluginId: string;
  /** 清单声明的配置项（未声明 ⇒ 空数组，不臆造） */
  items: PluginConfigItemView[];
  /** 已存储的原始键值（可能含清单未声明的遗留键） */
  values: Record<string, unknown>;
}

/**
 * 从清单里取 `configSchema`（结构不合法 ⇒ `undefined`，**不臆造**）。
 *
 * 参数用 `unknown` 是为了让调用方（CLI / 运行时端口）不必各自做一次 cast；
 * 形状校验集中在这里，只有 `items` 是数组才认。
 */
export function extractPluginConfigSchema(
  manifest: unknown
): PluginConfigSchema | undefined {
  if (!manifest || typeof manifest !== 'object') return undefined;
  const raw = (manifest as { configSchema?: unknown }).configSchema;
  if (!raw || typeof raw !== 'object') return undefined;
  if (!Array.isArray((raw as { items?: unknown }).items)) return undefined;
  return raw as PluginConfigSchema;
}

/**
 * 构造配置视图。
 *
 * `stored` 只来自 `PluginConfigManager.getConfig(pluginId)`（已存储值，不含默认合并）。
 */
export function buildPluginConfigView(
  pluginId: string,
  schema: PluginConfigSchema | undefined,
  stored: Record<string, unknown>
): PluginConfigView {
  const items: PluginConfigItemView[] = (schema?.items ?? []).map((item) => {
    const storedValue = stored[item.key];
    return {
      key: item.key,
      type: item.type,
      label: item.label,
      ...(item.description !== undefined
        ? { description: item.description }
        : {}),
      required: item.required === true,
      ...(item.default !== undefined ? { default: item.default } : {}),
      ...(item.options !== undefined ? { options: item.options } : {}),
      value: storedValue !== undefined ? storedValue : item.default,
      isSet: storedValue !== undefined,
    };
  });

  return { pluginId, items, values: { ...stored } };
}

/** patch 校验结果：`ok:false` 时 `errors` 直接回给调用方（HTTP 400 / CLI 失败文案） */
export type PluginConfigPatchResult =
  | { ok: true; values: Record<string, unknown> }
  | { ok: false; errors: string[] };

/**
 * 校验一次写入 patch（**合并后**校验，避免"分批写必填项"被误拒）。
 *
 * 口径：
 * - 清单未声明 schema ⇒ 无约束，原样放行（与 `PluginConfigManager` 同口径：本层不做校验）；
 * - 声明了 schema ⇒ 未声明的键直接拒（防拼写错误静默写入）；
 * - 校验用 `mergeWithDefaults(schema, stored ∪ patch)`，与 CLI 原有口径一致。
 */
export function validatePluginConfigPatch(
  schema: PluginConfigSchema | undefined,
  stored: Record<string, unknown>,
  patch: Record<string, unknown>
): PluginConfigPatchResult {
  if (!schema) {
    return { ok: true, values: { ...patch } };
  }

  const knownKeys = schema.items.map((item) => item.key);
  const unknownKeys = Object.keys(patch).filter(
    (key) => !knownKeys.includes(key)
  );
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      errors: [
        `配置项不存在：${unknownKeys.join(', ')}（可用：${knownKeys.join(', ') || '无'}）`,
      ],
    };
  }

  const merged = mergeWithDefaults(schema, { ...stored, ...patch });
  const validation = validatePluginConfig(schema, merged);
  if (!validation.valid) {
    return {
      ok: false,
      errors: validation.errors.map((e) => `${e.key}: ${e.message}`),
    };
  }

  return { ok: true, values: { ...patch } };
}
