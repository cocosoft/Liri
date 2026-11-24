/**
 * 批次 15 / P2-D 收尾：`pickRootTaskId` 的取舍回归锁。
 *
 * 会话里常有「主链 + 子阶段」两条 PDCA 记录，列表按最近活动倒序 ⇒ 子阶段常排在前面。
 * 子阶段没有步骤快照（`PdcaPipeline` 只能显示空态），故必须显式优先主链；
 * 没有主链时回退首条真实 taskId，不得编造。
 */
import { describe, expect, it } from "vitest";
import { pickRootTaskId } from "../planService";

describe("pickRootTaskId", () => {
  it("优先主链（跳过子阶段后缀）", () => {
    expect(
      pickRootTaskId([
        { taskId: "pdca_mwupjxor_requirement" },
        { taskId: "pdca_mwupjxor" },
      ]),
    ).toBe("pdca_mwupjxor");
  });

  it("只有子阶段时回退首条真实值（不造假）", () => {
    expect(
      pickRootTaskId([
        { taskId: "pdca_abc_requirement" },
        { taskId: "pdca_abc_design" },
      ]),
    ).toBe("pdca_abc_requirement");
  });

  it("空列表 / 无 taskId ⇒ null", () => {
    expect(pickRootTaskId([])).toBeNull();
    expect(pickRootTaskId([{}, { taskId: undefined }])).toBeNull();
  });
});
