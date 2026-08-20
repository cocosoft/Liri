/**
 * LlamaConfigPanel — llama.cpp 专业配置面板（设置模块）
 *
 * 面向专业人员暴露 llama-server 真实运行参数：
 * 服务（host/port/autoStart）、模型（GGUF 选择）、性能（GPU 层数/上下文）、
 * 以及「保存」与「应用并重启」动作。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
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
  type LlamaHardwareInfo,
  type LlamaModelRecommendation,
  type MigrateProgress,
  type LlamaMigrateResponse,
  type LlamaDownloadedModelInfo,
  type ModelDownloadRequest,
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

/** 判断推荐是否为最佳（与排序规则一致：适配度 → 质量分） */
function isBestRecommendation(
  target: LlamaModelRecommendation,
  list: LlamaModelRecommendation[],
): boolean {
  const sorted = [...list].sort((a, b) => {
    const suitOrder: Record<LlamaModelRecommendation["suitability"], number> = {
      high: 0,
      medium: 1,
      low: 2,
    };
    if (suitOrder[a.suitability] !== suitOrder[b.suitability]) {
      return suitOrder[a.suitability] - suitOrder[b.suitability];
    }
    return b.qualityScore - a.qualityScore;
  });
  return sorted[0]?.quantVersion === target.quantVersion;
}

function LlamaConfigPanel({ isDark }: LlamaConfigPanelProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<LlamaConfig | null>(null);
  const [status, setStatus] = useState<LlamaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // ─── 硬件检测 / 推荐 ──────────────────────────────────────────
  const [hardware, setHardware] = useState<LlamaHardwareInfo | null>(null);
  const [hardwareDetecting, setHardwareDetecting] = useState(false);
  const [recommendations, setRecommendations] = useState<LlamaModelRecommendation[]>([]);

  // ─── 迁移 ────────────────────────────────────────────────────
  const [migrating, setMigrating] = useState(false);
  const [migrateProgress, setMigrateProgress] = useState<MigrateProgress | null>(null);
  const [migrateResult, setMigrateResult] = useState<LlamaMigrateResponse | null>(null);
  const [migrateError, setMigrateError] = useState<string | null>(null);
  const [migrateShowConfirm, setMigrateShowConfirm] = useState(false);
  const [migrateCopy, setMigrateCopy] = useState(false);
  const [migrateOverwrite, setMigrateOverwrite] = useState(false);

  // ─── 下载 ────────────────────────────────────────────────────
  const [downloadingVersion, setDownloadingVersion] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{
    percent?: number;
    status?: string;
  } | null>(null);
  const [downloadComplete, setDownloadComplete] = useState<LlamaDownloadedModelInfo | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // ─── 强制杀死/重启操作 ──────────────────────────────────────
  const [forceKilling, setForceKilling] = useState(false);
  const [forceRestarting, setForceRestarting] = useState(false);
  const [showForceKillConfirm, setShowForceKillConfirm] = useState(false);
  const [showForceRestartConfirm, setShowForceRestartConfirm] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logsContent, setLogsContent] = useState<string>("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [logStreamActive, setLogStreamActive] = useState(false);
  const logStreamControllerRef = useRef<AbortController | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // ─── 模型删除确认 ──────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

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

  // 硬件检测：页面加载时自动执行一次
  const runHardwareDetection = useCallback(async (force = false) => {
    setHardwareDetecting(true);
    setError(null);
    try {
      const hw = await llamaService.detectHardware(force);
      setHardware(hw);
      const recs = await llamaService.getRecommendations();
      setRecommendations(recs);
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "detect_hardware" });
      setError(e instanceof Error ? e.message : "硬件检测失败");
    } finally {
      setHardwareDetecting(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void runHardwareDetection();
    return () => {
      if (logStreamControllerRef.current) {
        logStreamControllerRef.current.abort();
        logStreamControllerRef.current = null;
      }
    };
  }, [load, runHardwareDetection]);

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

  // ─── 目录浏览 ────────────────────────────────────────────────
  const handleBrowseDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "选择模型存储目录",
        defaultPath: config?.modelsDir || undefined,
      });
      if (selected && typeof selected === "string") {
        update({ modelsDir: selected });
      }
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "browse_dir" });
      setError(e instanceof Error ? e.message : "选择目录失败");
    }
  };

  // ─── 迁移 ────────────────────────────────────────────────────
  const handleStartMigration = async () => {
    if (!config?.modelsDir) return;
    setMigrateShowConfirm(false);
    setMigrating(true);
    setMigrateProgress(null);
    setMigrateResult(null);
    setMigrateError(null);

    try {
      await llamaService.startMigration(
        {
          targetDir: config.modelsDir,
          copy: migrateCopy,
          overwrite: migrateOverwrite,
        },
        {
          onProgress: (p) => setMigrateProgress(p),
          onComplete: (r) => setMigrateResult(r),
          onError: (e) => setMigrateError(e),
          onCancelled: () => setMigrateError("迁移已取消"),
        },
      );
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "migrate" });
      setMigrateError(e instanceof Error ? e.message : "迁移失败");
    } finally {
      setMigrating(false);
      void load();
    }
  };

  const handleCancelMigration = async () => {
    try {
      await llamaService.cancelMigration();
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "cancel_migrate" });
    }
  };

  // ─── 下载 ────────────────────────────────────────────────────
  const handleDownloadModel = async (rec: LlamaModelRecommendation) => {
    setDownloadingVersion(rec.quantVersion);
    setDownloadProgress({ percent: 0, status: "下载中" });
    setDownloadComplete(null);
    setDownloadError(null);

    const request: ModelDownloadRequest = {
      modelId: rec.modelId,
      quantVersion: rec.quantVersion,
      fileSizeGB: rec.fileSizeGB,
      qualityScore: rec.qualityScore,
      suitability: rec.suitability,
      estimatedRamGB: rec.estimatedRamGB,
      recommendationReason: rec.recommendationReason,
    };

    try {
      await llamaService.downloadModel(request, {
        autoStart: true,
        onProgress: (payload) => setDownloadProgress(payload),
        onComplete: (info) => setDownloadComplete(info),
        onError: (e) => setDownloadError(e),
      });
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "download_model" });
      setDownloadError(e instanceof Error ? e.message : "下载失败");
    } finally {
      setDownloadingVersion(null);
      void load();
    }
  };

  // ─── 删除 ────────────────────────────────────────────────────
  const handleDeleteModel = async () => {
    if (!deleteConfirm) return;
    const filename = deleteConfirm;
    setDeleteConfirm(null);
    try {
      await llamaService.deleteModel(filename);
      setSavedMsg(`已删除模型 ${filename}`);
      void load();
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "delete_model" });
      setError(e instanceof Error ? e.message : "删除模型失败");
    }
  };

  // ─── 强制杀死/重启 ────────────────────────────────────────────
  const handleForceKill = async () => {
    setShowForceKillConfirm(false);
    setForceKilling(true);
    setError(null);
    setSavedMsg(null);
    try {
      const result = await llamaService.forceKill();
      setSavedMsg(result.message);
      await load();
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "forceKill" });
      setError(e instanceof Error ? e.message : "强制杀死失败");
    } finally {
      setForceKilling(false);
    }
  };

  const handleForceRestart = async () => {
    setShowForceRestartConfirm(false);
    setForceRestarting(true);
    setError(null);
    setSavedMsg(null);
    try {
      const result = await llamaService.forceRestart();
      if (result.success) {
        setSavedMsg("llama-server 已强制重启");
      } else {
        setError("强制重启后服务未就绪");
      }
      await load();
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "forceRestart" });
      setError(e instanceof Error ? e.message : "强制重启失败");
    } finally {
      setForceRestarting(false);
    }
  };

  const handleViewLogs = async () => {
    setShowLogs(true);
    setLogsLoading(true);
    try {
      const logs = await llamaService.getLogs(500);
      setLogsContent(logs);
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "getLogs" });
      setLogsContent(`获取日志失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLogsLoading(false);
    }
  };

  // ─── 实时日志流 ──────────────────────────────────────────────
  const handleStartLogStream = async () => {
    if (logStreamControllerRef.current) {
      logStreamControllerRef.current.abort();
      logStreamControllerRef.current = null;
    }
    setShowLogs(true);
    setLogsContent("");
    setLogStreamActive(true);

    try {
      const controller = await llamaService.subscribeLogsStream({
        onInitial: (logs) => {
          setLogsContent(logs);
          logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
        },
        onLog: (logs) => {
          setLogsContent((prev) => prev + logs);
          logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
        },
        onError: (err) => {
          setLogsContent((prev) => prev + `\n[错误] ${err}\n`);
          setLogStreamActive(false);
        },
      }, 200);
      logStreamControllerRef.current = controller;
    } catch (e) {
      handleClientError(e, { module: "settings:llama", action: "subscribeLogs" });
      setLogStreamActive(false);
    }
  };

  const handleStopLogStream = () => {
    if (logStreamControllerRef.current) {
      logStreamControllerRef.current.abort();
      logStreamControllerRef.current = null;
    }
    setLogStreamActive(false);
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

        {/* 紧急操作 */}
        <ConfigItem label="紧急操作" isDark={isDark}>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setShowForceKillConfirm(true)}
              disabled={forceKilling || forceRestarting}
              className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="强制杀掉系统中所有 llama-server 进程"
            >
              {forceKilling ? "杀死中…" : "强制杀死"}
            </button>
            <button
              onClick={() => setShowForceRestartConfirm(true)}
              disabled={forceKilling || forceRestarting}
              className="px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
              title="强制杀掉并立即重启 llama-server"
            >
              {forceRestarting ? "重启中…" : "强制重启"}
            </button>
            <button
              onClick={() => void handleViewLogs()}
              disabled={logsLoading}
              className="px-3 py-1.5 text-xs bg-gray-500 hover:bg-gray-400 text-white rounded disabled:opacity-50"
              title="查看 llama-server 日志"
            >
              查看日志
            </button>
          </div>
        </ConfigItem>

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
          description="默认 11435（避开 Ollama 默认端口 11434）。启动时将自动检测端口可用性，被占用时会提示更换"
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
          description="保存并重启后自动同步到模型注册（无需手动匹配）"
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

      {/* ─── 系统检测 / 智能推荐（小白友好） ──────────── */}
      <ConfigSection
        title="系统检测"
        description="自动检测硬件配置，为您推荐最合适的 llama.cpp 模型版本"
        isDark={isDark}
      >
        {hardwareDetecting && (
          <div className="text-xs text-gray-500 dark:text-gray-400">
            正在检测硬件配置…
          </div>
        )}
        {hardware && !hardwareDetecting && (
          <>
            <ConfigItem label="CPU 核心" isDark={isDark}>
              <span className="text-sm">
                {hardware.cpuCores} 核心 / 系统 {hardware.systemMemoryGB} GB 内存
              </span>
            </ConfigItem>
            <ConfigItem label="GPU" isDark={isDark}>
              <span className="text-sm">
                {hardware.gpu.name
                  ? `${hardware.gpu.name} (${hardware.gpu.memoryGB} GB 显存)`
                  : "未检测到独立 GPU，将使用 CPU 推理"}
              </span>
            </ConfigItem>
            <ConfigItem label="推荐后端" isDark={isDark}>
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                  hardware.llamaCppBackend === "cpu"
                    ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                    : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                }`}
              >
                {hardware.llamaCppBackend === "cpu"
                  ? "CPU 推理"
                  : `GPU 加速 (${hardware.llamaCppBackend})`}
              </span>
            </ConfigItem>
          </>
        )}
        <button
          onClick={() => void runHardwareDetection(true)}
          disabled={hardwareDetecting}
          className="text-xs text-blue-500 hover:text-blue-600 disabled:opacity-50"
        >
          🔄 重新检测
        </button>
      </ConfigSection>

      {recommendations.length > 0 && (
        <ConfigSection
          title="为您推荐"
          description="基于您的硬件配置推荐的模型版本，点击「下载此版本」一键下载并自动配置"
          isDark={isDark}
        >
          <div className="space-y-3">
            {recommendations.map((rec) => {
              const isBest = isBestRecommendation(rec, recommendations);
              const suitClass =
                rec.suitability === "high"
                  ? "border-green-500 bg-green-50 dark:bg-green-900/20"
                  : rec.suitability === "medium"
                    ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20"
                    : "border-gray-300 opacity-70";
              return (
                <div
                  key={rec.quantVersion}
                  className={`p-3 rounded-lg border-2 ${suitClass}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{rec.displayName}</span>
                        <span className="text-xs text-gray-500">
                          {rec.quantVersion}
                        </span>
                        {isBest && (
                          <span className="px-1.5 py-0.5 text-xs rounded bg-green-500 text-white">
                            🏆 最佳推荐
                          </span>
                        )}
                        {rec.suitability === "high" && !isBest && (
                          <span className="px-1.5 py-0.5 text-xs rounded bg-green-100 text-green-700">
                            适配
                          </span>
                        )}
                        {rec.suitability === "medium" && (
                          <span className="px-1.5 py-0.5 text-xs rounded bg-yellow-100 text-yellow-700">
                            可用
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        大小 {rec.fileSizeGB} GB · 运行内存 ~{rec.estimatedRamGB} GB · 质量 {rec.qualityScore}/100
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        💡 {rec.recommendationReason}
                      </div>
                    </div>
                    <button
                      onClick={() => void handleDownloadModel(rec)}
                      disabled={downloadingVersion === rec.quantVersion}
                      className="shrink-0 px-3 py-1.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                    >
                      {downloadingVersion === rec.quantVersion
                        ? "下载中…"
                        : "下载此版本"}
                    </button>
                  </div>

                  {downloadingVersion === rec.quantVersion &&
                    downloadProgress && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>{downloadProgress.status ?? "下载中"}</span>
                          <span>{downloadProgress.percent ?? 0}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 transition-all duration-200"
                            style={{
                              width: `${downloadProgress.percent ?? 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                </div>
              );
            })}
          </div>
          {downloadComplete && (
            <div className="mt-3 p-2 bg-green-50 dark:bg-green-900/20 rounded text-xs text-green-700 dark:text-green-300">
              ✅ 模型 {downloadComplete.quantVersion} 已下载并自动配置完成
              {downloadComplete.autoStart ? "（服务已启动）" : ""}
            </div>
          )}
          {downloadError && (
            <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-600 dark:text-red-300">
              ❌ 下载失败：{downloadError}
            </div>
          )}
        </ConfigSection>
      )}

      {/* ─── 模型存储与迁移 ──────────────────────────────── */}
      <ConfigSection
        title="模型存储"
        description="管理 GGUF 模型文件存放位置，支持迁移现有模型到新目录"
        isDark={isDark}
      >
        <ConfigItem
          label="模型目录"
          description="自定义 GGUF 模型存放路径；留空使用默认路径"
          isDark={isDark}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <TextConfig
              isDark={isDark}
              value={config?.modelsDir ?? ""}
              onChange={(v) => update({ modelsDir: v })}
              placeholder={status?.modelsDir || "默认路径"}
              className="min-w-[320px] max-w-full flex-1"
            />
            <button
              onClick={() => void handleBrowseDir()}
              className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              浏览…
            </button>
            {config?.modelsDir && (
              <button
                onClick={() => update({ modelsDir: "" })}
                className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                title="恢复默认路径"
              >
                重置
              </button>
            )}
          </div>
        </ConfigItem>

        {status?.modelsDir && (
          <ConfigItem label="当前目录" isDark={isDark}>
            <div className="text-xs text-gray-500 dark:text-gray-400 break-all">
              <div>路径: {status.modelsDir}</div>
              <div>模型数: {status.models.length} 个</div>
            </div>
          </ConfigItem>
        )}

        {/* 迁移入口 */}
        {config?.modelsDir &&
          status?.modelsDir &&
          config.modelsDir !== status.modelsDir && (
            <ConfigItem
              label="迁移模型"
              description="将当前目录的模型文件迁移到新路径"
              isDark={isDark}
            >
              <div className="space-y-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={() => setMigrateShowConfirm(true)}
                    disabled={migrating}
                    className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
                  >
                    {migrating ? "迁移中…" : "迁移模型到新目录"}
                  </button>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={migrateCopy}
                      onChange={(e) => setMigrateCopy(e.target.checked)}
                    />
                    复制而非移动
                  </label>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={migrateOverwrite}
                      onChange={(e) => setMigrateOverwrite(e.target.checked)}
                    />
                    覆盖同名文件
                  </label>
                </div>

                {migrating && migrateProgress && (
                  <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded">
                    <div className="flex justify-between text-xs mb-1">
                      <span>
                        正在迁移：{migrateProgress.file} (
                        {migrateProgress.current}/{migrateProgress.total})
                      </span>
                      <span>{migrateProgress.percent}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-200"
                        style={{ width: `${migrateProgress.percent}%` }}
                      />
                    </div>
                    <button
                      onClick={() => void handleCancelMigration()}
                      className="mt-1 text-xs text-red-500 hover:text-red-600"
                    >
                      ✕ 取消迁移
                    </button>
                  </div>
                )}

                {!migrating && migrateResult && (
                  <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs">
                    <div className="font-medium">
                      迁移完成（耗时 {migrateResult.elapsedMs}ms）
                    </div>
                    <div>✓ 已迁移: {migrateResult.migratedFiles.length} 个文件</div>
                    {migrateResult.skippedFiles.length > 0 && (
                      <div className="text-yellow-600">
                        ⊘ 已跳过: {migrateResult.skippedFiles.length} 个
                      </div>
                    )}
                    {migrateResult.failedFiles.length > 0 && (
                      <div className="text-red-600">
                        ✗ 失败: {migrateResult.failedFiles.length} 个
                      </div>
                    )}
                  </div>
                )}

                {!migrating && migrateError && (
                  <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded text-xs text-red-600 dark:text-red-300">
                    ❌ {migrateError}
                  </div>
                )}
              </div>
            </ConfigItem>
          )}

        {/* 二次确认对话框 */}
        {migrateShowConfirm && config?.modelsDir && status?.modelsDir && (
          <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs">
            <div className="font-medium mb-1">确认迁移模型</div>
            <p>
              将{migrateCopy ? "复制" : "移动"}当前目录的
              <b>{status.models.length}</b> 个模型文件到：
            </p>
            <p className="font-mono mt-1 break-all">{config.modelsDir}</p>
            {!migrateCopy && (
              <p className="text-red-500 mt-1">
                ⚠ 移动模式下，源目录文件将被删除，此操作不可逆。
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => void handleStartMigration()}
                className="px-3 py-1 bg-blue-500 text-white rounded"
              >
                确定迁移
              </button>
              <button
                onClick={() => setMigrateShowConfirm(false)}
                className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </ConfigSection>

      {/* ─── 模型管理（删除） ────────────────────────────── */}
      {status && status.models.length > 0 && (
        <ConfigSection
          title="模型管理"
          description="当前已识别的 GGUF 模型，可删除不需要的文件"
          isDark={isDark}
        >
          <div className="space-y-1">
            {status.models.map((modelPath) => {
              const fileName = modelPath.split(/[\\/]/).pop() || modelPath;
              const isInUse = config?.model === modelPath;
              return (
                <div
                  key={modelPath}
                  className="flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <span className="text-xs font-mono truncate flex-1">
                    {fileName}
                    {isInUse && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                        当前使用
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => setDeleteConfirm(fileName)}
                    disabled={isInUse}
                    className="text-xs text-red-500 hover:text-red-600 disabled:opacity-30"
                  >
                    删除
                  </button>
                </div>
              );
            })}
          </div>

          {deleteConfirm && (
            <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded text-xs">
              <div className="mb-1">
                确认删除模型 <b>{deleteConfirm}</b>？此操作不可恢复。
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void handleDeleteModel()}
                  className="px-3 py-1 bg-red-500 text-white rounded"
                >
                  确认删除
                </button>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </ConfigSection>
      )}

      {/* ─── 紧急操作确认对话框 ──────────────────────────────────── */}
      {showForceKillConfirm && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-xs">
          <div className="font-medium text-red-600 mb-1">⚠ 警告</div>
          <div className="mb-2">
            此操作将<strong>强制杀掉系统中所有 llama-server 进程</strong>，
            包括可能由其他程序或终端启动的实例。该操作不可撤销。
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void handleForceKill()}
              disabled={forceKilling}
              className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded disabled:opacity-50"
            >
              {forceKilling ? "杀死中…" : "确认强制杀死"}
            </button>
            <button
              onClick={() => setShowForceKillConfirm(false)}
              disabled={forceKilling}
              className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {showForceRestartConfirm && (
        <div className="p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded text-xs">
          <div className="font-medium text-orange-600 mb-1">⚠ 警告</div>
          <div className="mb-2">
            此操作将<strong>强制杀掉所有 llama-server 进程并立即重启</strong>。
            如果模型加载较慢，重启后可能需要等待一段时间才能就绪。
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => void handleForceRestart()}
              disabled={forceRestarting}
              className="px-3 py-1 bg-orange-600 hover:bg-orange-500 text-white rounded disabled:opacity-50"
            >
              {forceRestarting ? "重启中…" : "确认强制重启"}
            </button>
            <button
              onClick={() => setShowForceRestartConfirm(false)}
              disabled={forceRestarting}
              className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* ─── 日志查看面板 ──────────────────────────────────────── */}
      {showLogs && (
        <ConfigSection
          title={`llama-server 日志${logStreamActive ? " · 🟢 实时追踪中" : ""}`}
          description="llama-server 服务的运行日志，用于排查问题"
          isDark={isDark}
        >
          <div className="flex items-center gap-2 mb-2">
            {logStreamActive ? (
              <button
                onClick={handleStopLogStream}
                className="text-xs text-red-500 hover:text-red-600"
              >
                ⏹ 停止追踪
              </button>
            ) : (
              <button
                onClick={() => void handleStartLogStream()}
                className="text-xs text-green-500 hover:text-green-600"
              >
                ▶ 开始实时追踪
              </button>
            )}
            <button
              onClick={() => void handleViewLogs()}
              disabled={logsLoading || logStreamActive}
              className="text-xs text-blue-500 hover:text-blue-600 disabled:opacity-50"
            >
              {logsLoading ? "加载中…" : "🔄 刷新日志"}
            </button>
            <button
              onClick={() => {
                handleStopLogStream();
                setShowLogs(false);
              }}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              ✕ 关闭
            </button>
          </div>
          <div className="bg-gray-900 dark:bg-black rounded p-2 max-h-96 overflow-auto">
            <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap break-all">
              {logsContent || "暂无日志"}
            </pre>
            <div ref={logsEndRef} />
          </div>
          {logStreamActive && (
            <div className="mt-1 text-xs text-green-600 animate-pulse">
              ● 实时追踪中... 日志将自动更新
            </div>
          )}
        </ConfigSection>
      )}
    </div>
  );
}

export default LlamaConfigPanel;
