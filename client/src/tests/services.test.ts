import { describe, it, expect, vi, beforeEach } from "vitest";
import { sessionService } from "../services/sessionService";
import { configService } from "../services/configService";
import { toolService } from "../services/toolService";
import { fileService } from "../services/fileService";
import { knowledgeService } from "../services/knowledgeService";
import { agentService } from "../services/agentService";
import { statsService } from "../services/statsService";
import { buildStreamFailureMessage } from "../services/chatService";

/**
 * Mock httpLegacy 使其始终抛异常，
 * 强制所有服务走内存回退路径（fallback），
 * 避免测试环境中实际运行的 backend 影响测试结果。
 */
vi.mock("../services/httpClient", () => ({
  httpLegacy: {
    get: vi.fn().mockRejectedValue(new Error("Mocked: no backend")),
    post: vi.fn().mockRejectedValue(new Error("Mocked: no backend")),
    put: vi.fn().mockRejectedValue(new Error("Mocked: no backend")),
    delete: vi.fn().mockRejectedValue(new Error("Mocked: no backend")),
    patch: vi.fn().mockRejectedValue(new Error("Mocked: no backend")),
  },
  http: {
    get: vi.fn().mockRejectedValue(new Error("Mocked: no backend")),
    post: vi.fn().mockRejectedValue(new Error("Mocked: no backend")),
    put: vi.fn().mockRejectedValue(new Error("Mocked: no backend")),
    delete: vi.fn().mockRejectedValue(new Error("Mocked: no backend")),
    patch: vi.fn().mockRejectedValue(new Error("Mocked: no backend")),
  },
  setHttpTimeout: vi.fn((_ms: number) => 30000),
}));

// Mock fetch 确保 health check 不访问真实后端
vi.stubGlobal(
  "fetch",
  vi.fn().mockRejectedValue(new Error("Mocked: fetch failed")),
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SessionService (fallback)", () => {
  it("list returns empty array", async () => {
    const sessions = await sessionService.list();
    expect(sessions).toEqual([]);
  });

  it("create returns a local session", async () => {
    const session = await sessionService.create("测试会话");
    expect(session.id).toContain("local-");
    expect(session.title).toBe("测试会话");
    expect(session.createdAt).toBeTruthy();
    expect(typeof session.createdAt).toBe("string");
    expect(session.messageCount).toBe(0);
  });

  it("switch returns a session", async () => {
    const session = await sessionService.switch("any-id");
    expect(session.id).toBe("any-id");
  });

  it("delete resolves successfully", async () => {
    await expect(sessionService.delete("any-id")).resolves.toBeUndefined();
  });

  it("rename resolves successfully", async () => {
    await expect(
      sessionService.rename("any-id", "新名称"),
    ).resolves.toBeUndefined();
  });

  it("getCurrent returns null", async () => {
    const current = await sessionService.getCurrent();
    expect(current).toBeNull();
  });
});

describe("ConfigService (fallback)", () => {
  it("list returns empty object", async () => {
    const config = await configService.list();
    expect(config).toEqual({});
  });

  it("get returns null for unknown key", async () => {
    const value = await configService.get("nonexistent");
    expect(value).toBeNull();
  });

  it("set and get round-trip", async () => {
    await configService.set("theme", "dark");
    const value = await configService.get("theme");
    expect(value).toBe("dark");
  });

  it("set and list round-trip", async () => {
    await configService.set("lang", "zh");
    const all = await configService.list();
    expect(all.lang).toBe("zh");
  });

  it("overwrites existing value", async () => {
    await configService.set("key", "first");
    await configService.set("key", "second");
    const value = await configService.get("key");
    expect(value).toBe("second");
  });
});

describe("ToolService (fallback)", () => {
  it("list returns empty array", async () => {
    const tools = await toolService.list();
    expect(tools).toEqual([]);
  });

  it("execute returns fallback message", async () => {
    const result = await toolService.execute("test", {});
    expect(result).toHaveProperty("success", false);
    expect(result).toHaveProperty("error");
    expect(typeof (result as any).error).toBe("string");
  });
});

describe("FileService (fallback)", () => {
  it("listDir returns empty array", async () => {
    const entries = await fileService.listDir("/");
    expect(entries).toEqual([]);
  });

  it("readFile throws error", async () => {
    await expect(fileService.readFile("/test.txt")).rejects.toThrow(
      "File operations unavailable outside Tauri",
    );
  });
});

describe("KnowledgeService (backend unavailable)", () => {
  // KnowledgeService 为 HTTP-only（服务层职责边界：unwrap 失败即抛错），
  // 后端不可用时错误向上传播，由调用方（页面）展示错误状态。
  it("list throws when backend unavailable", async () => {
    await expect(knowledgeService.list()).rejects.toThrow("Mocked: no backend");
  });

  it("get throws when backend unavailable", async () => {
    await expect(knowledgeService.get("any-id")).rejects.toThrow(
      "Mocked: no backend",
    );
  });

  it("delete throws when backend unavailable", async () => {
    await expect(knowledgeService.delete("any-id")).rejects.toThrow(
      "Mocked: no backend",
    );
  });

  it("search throws when backend unavailable", async () => {
    await expect(knowledgeService.search("test")).rejects.toThrow(
      "Mocked: no backend",
    );
  });
});

describe("AgentService (fallback)", () => {
  it("listTasks returns empty array", async () => {
    const tasks = await agentService.listTasks();
    expect(tasks).toEqual([]);
  });

  it("executeTask returns completed task", async () => {
    const task = await agentService.executeTask("test-task");
    expect(task.id).toContain("local-");
    expect(task.name).toBe("test-task");
    expect(task.status).toBe("completed");
    expect(task.result).toContain("unavailable");
  });

  it("cancelTask resolves successfully", async () => {
    await expect(agentService.cancelTask("any-id")).resolves.toBeUndefined();
  });
});

describe("StatsService (fallback)", () => {
  it("getDashboardStats returns offline state", async () => {
    const stats = await statsService.getDashboardStats();
    expect(stats.backend.running).toBe(false);
    expect(stats.models).toBe(0);
    expect(stats.tools).toBe(0);
    expect(stats.sessions).toBe(0);
  });
});

describe("buildStreamFailureMessage（§13.9 报错语义拆分）", () => {
  it("消息已落盘：提示可直接重新发送", () => {
    const msg = buildStreamFailureMessage(true, "尚未产生内容");
    expect(msg).toContain("连接已断开，且无可用检查点");
    expect(msg).toContain("您的消息已保存");
    expect(msg).toContain("可直接重新发送");
    expect(msg).not.toContain("自动补发");
  });

  it("消息未落盘：提示 outbox 网络恢复后自动补发", () => {
    const msg = buildStreamFailureMessage(false, "尚未产生内容");
    expect(msg).toContain("网络恢复后将自动补发");
    expect(msg).toContain("无需重复发送");
    expect(msg).not.toContain("重新发送以继续");
  });

  it("保留已生成内容进度统计", () => {
    const msg = buildStreamFailureMessage(
      true,
      "已生成 123 字符内容、完成 1 次工具调用",
    );
    expect(msg).toContain("已生成 123 字符内容");
    expect(msg).toContain("完成 1 次工具调用");
  });
});
