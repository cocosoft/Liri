/**
 * LlamaConfigPanel — llama.cpp 专业配置面板（设置模块）
 *
 * 面向专业人员暴露 llama-server 真实运行参数：
 * 服务（host/port/autoStart）、模型（GGUF 选择）、性能（GPU 层数/上下文）、
 * 以及「保存」与「应用并重启」动作。
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ConfigSection,
  ConfigItem,
  SelectConfig,
  TextConfig,
  ToggleConfig,
} from "./ConfigComponents";
import {
  llamaService,
  type LlamaConfig,
  type LlamaStatus,
  type LlamaKvCacheTier,
} from "../../services/llamaService";
import { handleClientError } from "../../utils/handleError";

interface LlamaConfigPanelProps {
  isDark: boolean;
}

const STATUS_LABEL: Record<LlamaStatus["status"], string> = {
  stopped: "已停止",
  downloading: "下载中…",
  starting: "启动中…",
  running: "运行中",
  error: "异常",
};

/** KV cache 档位选项（D1: low=q4_0 / medium=q8_0 / high=f16） */
const KV_CACHE_OPTIONS: { value: LlamaKvCacheTier; label: string }[] = [
  { value: "low", label: "低 (q4_0)" },
  { value: "medium", label: "中 (q8_0)" },
  { value: "high", label: "高 (f16)" },
];

/** Flash Attention 三态（D2 显式传默认值 auto） */
const FLASH_ATTN_OPTIONS = [
  { value: "auto", label: "自动 (auto)" },
  { value: "on", label: "开启 (on)" },
  { value: "off", label: "关闭 (off)" },
];

/** 数值输入解析：非数字回退默认值 */
function toNum(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isNaN(n) ? fallback : n;
}

function LlamaConfigPanel({ isDark }: LlamaConfigPanelProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<LlamaConfig | null>(null);
  const [status, setStatus] = useState<LlamaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { config: cfg, status: st } = await llamaService.getConfig();
      setConfig(cfg);
      setStatus(st);
      setError(null);
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "load" });
      setError(e instanceof Error ? e.message : "加载 llama.cpp 配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (patch: Partial<LlamaConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const handleSave = async (restart: boolean) => {
    if (!config) return;
    setSaving(true);
    setSavedMsg(null);
    setError(null);
    try {
      const saved = await llamaService.saveConfig(config);
      setConfig(saved);
      if (restart) {
        await llamaService.restart();
        setSavedMsg("配置已保存并重启服务");
      } else {
        setSavedMsg("配置已保存（重启后生效）");
      }
      await load(); // 刷新状态（含模型列表）
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "save" });
      setError(e instanceof Error ? e.message : "保存配置失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className={`p-6 ${isDark ? "text-gray-400" : "text-gray-500"}`}>
        加载中…
      </div>
    );
  }

  const modelOptions = (status?.models ?? []).map((p) => ({
    value: p,
    label: p.split(/[\\/]/).pop() || p,
  }));

  return (
    <div className="p-6">
      <ConfigSection
        title="llama.cpp 本地推理"
        description="基于 llama.cpp（内置 llama-server），为本地推理提供贴近实际环境的精细配置"
        isDark={isDark}
      >
        {/* 服务状态 */}
        <ConfigItem label="服务状态" isDark={isDark}>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                status?.running
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : status?.status === "error"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400"
              }`}
            >
              {status ? STATUS_LABEL[status.status] : "未知"}
            </span>
            {status && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                v{status.version} · 端口 {status.port} · 重启{" "}
                {status.restartCount} 次
                {status.binaryExists ? "" : " · 二进制缺失"}
              </span>
            )}
          </div>
        </ConfigItem>
        {status?.lastError && (
          <ConfigItem label="最近错误" isDark={isDark}>
            <span className="text-xs text-red-500">{status.lastError}</span>
          </ConfigItem>
        )}

        {/* 服务配置 */}
        <ConfigItem label="监听地址" isDark={isDark}>
          <TextConfig
            isDark={isDark}
            value={config?.host ?? "127.0.0.1"}
            onChange={(v) => update({ host: v })}
            placeholder="127.0.0.1"
            className="w-48"
          />
        </ConfigItem>
        <ConfigItem
          label="端口"
          description="避开 Ollama 默认端口 11434"
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.port ?? 11435)}
            onChange={(v) => update({ port: parseInt(v, 10) || 11435 })}
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem label="随应用自动启动" isDark={isDark}>
          <ToggleConfig
            isDark={isDark}
            checked={config?.autoStart ?? true}
            onChange={(v) => update({ autoStart: v })}
          />
        </ConfigItem>

        {/* 模型配置 */}
        <ConfigItem
          label="GGUF 模型"
          description="从本地模型目录扫描"
          isDark={isDark}
        >
          <SelectConfig
            isDark={isDark}
            value={config?.model ?? ""}
            onChange={(v) => update({ model: v })}
            options={[{ value: "", label: "（不设置）" }, ...modelOptions]}
          />
        </ConfigItem>
        {config?.model && (
          <ConfigItem label="当前模型路径" isDark={isDark}>
            <span className="text-xs text-gray-500 dark:text-gray-400 break-all">
              {config.model}
            </span>
          </ConfigItem>
        )}

        {/* 性能配置 */}
        <ConfigItem
          label="GPU 层数 (-ngl)"
          description="0 = 纯 CPU；有 CUDA 二进制时可用 GPU"
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.gpuLayers ?? 0)}
            onChange={(v) =>
              update({ gpuLayers: Math.max(0, parseInt(v, 10) || 0) })
            }
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem
          label="上下文窗口 (-c)"
          description="需与模型注册的 context_window 匹配"
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.contextWindow ?? 4096)}
            onChange={(v) =>
              update({ contextWindow: Math.max(512, parseInt(v, 10) || 4096) })
            }
            className="w-28"
          />
        </ConfigItem>
        <ConfigItem
          label="KV cache 量化"
          description="档位: 低=q4_0 / 中=q8_0 / 高=f16（显存敏感）"
          isDark={isDark}
        >
          <SelectConfig
            isDark={isDark}
            value={config?.kvCache ?? "high"}
            onChange={(v) => update({ kvCache: v as LlamaKvCacheTier })}
            options={KV_CACHE_OPTIONS}
            className="w-32"
          />
        </ConfigItem>
        <ConfigItem
          label="线程数 (-t)"
          description="0 = 自动（按 CPU 核心数）"
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.threads ?? 0)}
            onChange={(v) =>
              update({ threads: Math.max(0, Math.round(toNum(v, 0))) })
            }
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem
          label="批大小 (-b)"
          description="0 = 自动（默认 2048）"
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.batchSize ?? 0)}
            onChange={(v) =>
              update({ batchSize: Math.max(0, Math.round(toNum(v, 0))) })
            }
            className="w-24"
          />
        </ConfigItem>

        {/* 采样配置（D2：显式传默认值，与 llama.cpp 默认一致） */}
        <ConfigItem
          label="温度 (--temp)"
          description="默认 0.8"
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.temperature ?? 0.8)}
            onChange={(v) => update({ temperature: toNum(v, 0.8) })}
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem
          label="Top-K (--top-k)"
          description="默认 40"
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.topK ?? 40)}
            onChange={(v) =>
              update({ topK: Math.max(1, Math.round(toNum(v, 40))) })
            }
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem
          label="Top-P (--top-p)"
          description="默认 0.95"
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.topP ?? 0.95)}
            onChange={(v) => update({ topP: toNum(v, 0.95) })}
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem
          label="重复惩罚 (--repeat-penalty)"
          description="默认 1.1"
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.repeatPenalty ?? 1.1)}
            onChange={(v) => update({ repeatPenalty: toNum(v, 1.1) })}
            className="w-24"
          />
        </ConfigItem>
        <ConfigItem
          label="随机种子 (--seed)"
          description="-1 = 随机"
          isDark={isDark}
        >
          <TextConfig
            isDark={isDark}
            type="number"
            value={String(config?.seed ?? -1)}
            onChange={(v) => update({ seed: Math.round(toNum(v, -1)) })}
            className="w-24"
          />
        </ConfigItem>

        {/* 高级配置 */}
        <ConfigItem
          label="--no-mmap"
          description="禁用内存映射加载"
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={config?.noMmap ?? false}
            onChange={(v) => update({ noMmap: v })}
          />
        </ConfigItem>
        <ConfigItem
          label="--mlock"
          description="锁定内存防止换页"
          isDark={isDark}
        >
          <ToggleConfig
            isDark={isDark}
            checked={config?.mlock ?? false}
            onChange={(v) => update({ mlock: v })}
          />
        </ConfigItem>
        <ConfigItem
          label="Flash Attention (--flash-attn)"
          description="显存充足时建议开启"
          isDark={isDark}
        >
          <SelectConfig
            isDark={isDark}
            value={config?.flashAttn ?? "auto"}
            onChange={(v) =>
              update({ flashAttn: v as LlamaConfig["flashAttn"] })
            }
            options={FLASH_ATTN_OPTIONS}
            className="w-32"
          />
        </ConfigItem>

        {error && (
          <ConfigItem label="" isDark={isDark}>
            <span className="text-xs text-red-500">{error}</span>
          </ConfigItem>
        )}
        {savedMsg && (
          <ConfigItem label="" isDark={isDark}>
            <span className="text-xs text-green-600 dark:text-green-400">
              {savedMsg}
            </span>
          </ConfigItem>
        )}

        <div className="flex gap-2 mt-4">
          <button
            onClick={() => handleSave(false)}
            disabled={saving}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              saving
                ? "opacity-50 cursor-not-allowed bg-gray-500 text-white"
                : "bg-blue-600 hover:bg-blue-500 text-white"
            }`}
          >
            {saving ? "保存中…" : t("settings.llamaSave")}
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={saving}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              saving
                ? "opacity-50 cursor-not-allowed bg-gray-500 text-white"
                : "bg-indigo-600 hover:bg-indigo-500 text-white"
            }`}
          >
            {saving ? "重启中…" : "保存并重启"}
          </button>
        </div>
      </ConfigSection>
    </div>
  );
}

export default LlamaConfigPanel;
