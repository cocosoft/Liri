/**
 * approvalAuditCsv 单测（PR-3c 尾声，2026-10-23）
 *
 * 断言的是**导出可用**：RFC 4180 转义（逗号 / 引号 / 换行），空值不产出 `undefined`。
 */

import { describe, expect, it } from "vitest";

import {
  buildApprovalAuditCsv,
  csvCell,
  DEFAULT_AUDIT_CSV_HEADERS,
  type ApprovalAuditEvent,
} from "../approvalAuditCsv";

describe("approvalAuditCsv · 单元格转义", () => {
  it("普通文本原样", () => {
    expect(csvCell("dir")).toBe("dir");
  });

  it("含逗号 / 引号 / 换行 ⇒ 加引号并把内部引号翻倍", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("空 / null / undefined ⇒ 空串", () => {
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(null)).toBe("");
    expect(csvCell("")).toBe("");
  });
});

describe("approvalAuditCsv · 行拼装", () => {
  it("空事件 ⇒ 仅表头", () => {
    expect(buildApprovalAuditCsv([])).toBe(
      DEFAULT_AUDIT_CSV_HEADERS.join(",")
    );
  });

  it("字段按「时间/来源/工具/风险/会话/明细」顺序，来源多条用 | 连接", () => {
    const events: ApprovalAuditEvent[] = [
      {
        timestamp: "2026-10-23T02:00:00.000Z",
        matchedRules: ["approval:sandbox"],
        command: "file_write",
        riskLevel: "write",
        sessionContext: { sessionId: "s-1" },
        truncatedResult: "mode=landlock permissionLevel=standard",
      },
    ];
    const lines = buildApprovalAuditCsv(events).split("\r\n");
    expect(lines[0]).toBe(DEFAULT_AUDIT_CSV_HEADERS.join(","));
    expect(lines[1]).toBe(
      "2026-10-23T02:00:00.000Z,approval:sandbox,file_write,write,s-1,mode=landlock permissionLevel=standard"
    );
  });

  it("缺失字段 ⇒ 空单元格（不出现 undefined）", () => {
    const csv = buildApprovalAuditCsv([{}]);
    expect(csv).not.toContain("undefined");
    expect(csv.split("\r\n")[1]).toBe(",,,,,");
  });

  it("自定义表头（按当前语言）生效", () => {
    const csv = buildApprovalAuditCsv([], ["Time", "Source"]);
    expect(csv).toBe("Time,Source");
  });
});
