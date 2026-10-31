/**
 * 2026-10-31（隔离缺陷 P2）：前端作用域下推的**透传**守卫。
 *
 * - `sessionService.list(opts)` 必须把 `moduleType` / `projectId` 拼进 query；
 * - 不传（统计页、项目计数等全量消费方）必须**保持原 URL**（无 query）；
 * - 读侧兜底：`inferModuleTypeFromWorkspaceId` 认 `proj_*`（§七裁定 2）。
 *
 * 运行方式：`bun run test`（vitest）——本文件用 vitest 专属 API。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock("../services/httpClient", () => ({
  http: {
    get: getMock,
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
  httpLegacy: {
    get: getMock,
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
  },
  setHttpTimeout: vi.fn((_ms: number) => 30000),
}));

import { sessionService } from "../services/sessionService";
import { ENDPOINTS } from "../services/endpoints";
import { inferModuleTypeFromWorkspaceId } from "../stores/root-store/moduleContextSlice";

beforeEach(() => {
  getMock.mockReset();
  getMock.mockResolvedValue({ ok: true, data: [] });
});

describe("sessionService.list 作用域透传", () => {
  it("不传作用域 ⇒ 保持原 URL（全量语义）", async () => {
    await sessionService.list();
    expect(getMock).toHaveBeenCalledWith(ENDPOINTS.session.base);
  });

  it("传 moduleType + projectId ⇒ 拼进 query", async () => {
    await sessionService.list({ moduleType: "project", projectId: "proj_1792_aa" });
    expect(getMock).toHaveBeenCalledWith(
      `${ENDPOINTS.session.base}?moduleType=project&projectId=proj_1792_aa`,
    );
  });

  it("只传 moduleType（chat 作用域）⇒ 只带该参数；空白值视为未传", async () => {
    await sessionService.list({ moduleType: "chat" });
    expect(getMock).toHaveBeenLastCalledWith(
      `${ENDPOINTS.session.base}?moduleType=chat`,
    );

    await sessionService.list({ moduleType: "   ", projectId: "" });
    expect(getMock).toHaveBeenLastCalledWith(ENDPOINTS.session.base);
  });
});

describe("inferModuleTypeFromWorkspaceId（read-side 兜底）", () => {
  it("proj_* 归 project（此前不认 ⇒ 落 chat）", () => {
    expect(inferModuleTypeFromWorkspaceId("proj_1792989560642_1367c1")).toBe(
      "project",
    );
    expect(inferModuleTypeFromWorkspaceId("project-abc")).toBe("project");
    expect(inferModuleTypeFromWorkspaceId("projects")).toBe("project");
  });

  it("其余保持原语义", () => {
    expect(inferModuleTypeFromWorkspaceId("chat")).toBe("chat");
    expect(inferModuleTypeFromWorkspaceId("")).toBe("chat");
    expect(inferModuleTypeFromWorkspaceId("office")).toBe("office");
    expect(inferModuleTypeFromWorkspaceId("proj_")).toBe("chat");
  });
});
