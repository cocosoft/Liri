/**
 * BUG-04（2026-10-22 前端巡检）：llama.cpp 推荐卡标识必须带 modelId
 *
 * 缺陷现场：推荐列表是「多模型 × 多量化」的笛卡尔集合（实测 Q8_0 / Q6_K / Q5_K_M
 * 各出现 6 次），旧实现用 `key={rec.quantVersion}` ⇒ React 报
 * `Encountered two children with the same key`，且下载中状态按 quantVersion 比较
 * ⇒ 不同模型会"同时显示下载中"。`isBestRecommendation` 同源缺陷：按 quantVersion
 * 比较会把多个模型都标成「最佳推荐」。
 *
 * 本文件锁三件事：
 *  ① `recommendationKey()` 在同量化多模型下唯一；
 *  ② `isBestRecommendation()` 只有一个最佳（按元素身份，不再按 quantVersion）；
 *  ③ 真实渲染推荐卡时**不产生**重复 key 警告（含同 quantVersion 多条）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";

// vi.mock 工厂会被提升到 import 之前 ⇒ 夹具必须经 vi.hoisted 提前初始化（避免 TDZ）
const fixture = vi.hoisted(() => {
  const recs = [
    {
      modelId: "qwen2.5-7b",
      displayName: "Qwen2.5-7B",
      quantVersion: "Q8_0",
      fileSizeGB: 7.5,
      qualityScore: 95,
      suitability: "high" as const,
      estimatedRamGB: 9,
      recommendedGpuLayers: 32,
      recommendationReason: "质量最高",
    },
    {
      modelId: "qwen2.5-7b",
      displayName: "Qwen2.5-7B",
      quantVersion: "Q6_K",
      fileSizeGB: 5.5,
      qualityScore: 92,
      suitability: "high" as const,
      estimatedRamGB: 7,
      recommendedGpuLayers: 32,
      recommendationReason: "质量/体积均衡",
    },
    {
      modelId: "llama3.1-8b",
      displayName: "Llama3.1-8B",
      quantVersion: "Q8_0",
      fileSizeGB: 8.5,
      qualityScore: 90,
      suitability: "high" as const,
      estimatedRamGB: 10,
      recommendedGpuLayers: 33,
      recommendationReason: "通用能力强",
    },
    {
      modelId: "llama3.1-8b",
      displayName: "Llama3.1-8B",
      quantVersion: "Q6_K",
      fileSizeGB: 6.5,
      qualityScore: 88,
      suitability: "medium" as const,
      estimatedRamGB: 8,
      recommendedGpuLayers: 33,
      recommendationReason: "显存友好",
    },
  ];

  const config = {
    host: "127.0.0.1",
    port: 8080,
    model: "",
    autoStart: false,
    gpuLayers: 0,
    contextWindow: 4096,
    kvCache: "medium" as const,
    threads: 0,
    batchSize: 2048,
    temperature: 0.7,
    topK: 40,
    topP: 0.9,
    repeatPenalty: 1.1,
    seed: -1,
    noMmap: false,
    mlock: false,
    flashAttn: "auto" as const,
  };

  const status = {
    status: "stopped" as const,
    version: "b4000",
    binaryExists: true,
    running: false,
    host: "127.0.0.1",
    port: 8080,
    model: "",
    models: [] as string[],
    modelsDir: "C:/models",
    lastError: null,
    restartCount: 0,
  };

  const hardware = {
    platform: "win32" as const,
    cpuCores: 16,
    systemMemoryGB: 32,
    gpu: { name: "RTX 4060", memoryGB: 8, backend: "cuda" as const },
    llamaCppBackend: "cuda" as const,
    lastUpdated: 0,
  };

  return { recs, config, status, hardware };
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("../services/llamaService", () => ({
  llamaService: {
    getConfig: vi
      .fn()
      .mockResolvedValue({ config: fixture.config, status: fixture.status }),
    detectHardware: vi.fn().mockResolvedValue(fixture.hardware),
    getRecommendations: vi.fn().mockResolvedValue(fixture.recs),
    getLogs: vi.fn().mockResolvedValue([]),
    subscribeLogsStream: vi.fn().mockResolvedValue({ abort: vi.fn() }),
  },
}));

import LlamaConfigPanel, {
  isBestRecommendation,
  recommendationKey,
} from "../components/settings/LlamaConfigPanel";

const RECS = fixture.recs;

describe("BUG-04：推荐卡标识（modelId + quantVersion）", () => {
  it("同量化版本、不同模型 ⇒ 标识互不相同", () => {
    const keys = RECS.map(recommendationKey);
    expect(new Set(keys).size).toBe(RECS.length);
    expect(keys[0]).toBe("qwen2.5-7b:Q8_0");
    expect(keys[2]).toBe("llama3.1-8b:Q8_0");
  });

  it("isBestRecommendation：同量化版本多模型下仍只有一个最佳", () => {
    const best = RECS.filter((r) => isBestRecommendation(r, RECS));
    expect(best).toHaveLength(1);
    // 排序规则：适配度优先，其次质量分 ⇒ Qwen2.5-7B / Q8_0
    expect(best[0].modelId).toBe("qwen2.5-7b");
    expect(best[0].quantVersion).toBe("Q8_0");
  });

  describe("真实渲染：不产生重复 key 警告", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
      cleanup();
    });

    it("四条推荐（Q8_0 ×2 / Q6_K ×2）全部渲染且无 'same key' 报错", async () => {
      render(<LlamaConfigPanel isDark={false} />);

      await waitFor(() => {
        expect(screen.getAllByText("Qwen2.5-7B")).toHaveLength(2);
      });
      expect(screen.getAllByText("Llama3.1-8B")).toHaveLength(2);
      // 最佳推荐只出现一次（旧实现按 quantVersion 比较会标多次）
      expect(screen.getAllByText("🏆 最佳推荐")).toHaveLength(1);

      const dupKeyCalls = errorSpy.mock.calls.filter((args: unknown[]) =>
        String(args[0] ?? "").includes("same key"),
      );
      expect(dupKeyCalls).toHaveLength(0);
    });
  });
});
