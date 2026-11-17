/**
 * permissionService 写接口结构化错误体（R0–R5 前置改造）
 *
 * 为什么必须保留 `payload`：规则写接口用 **HTTP 状态 + `error.code`** 表达分支
 * （409 `impact` / 409 `conflict` / 403 `readonly`…）。只留 `message` 会迫使调用方
 * 用文案判断分支（`CS02` 禁止），而影响预演还需要 `error.impact` 才能展示清单。
 */
import { describe, expect, it } from "vitest";

import { HTTPClientError } from "../httpClient";
import { formatError } from "../httpUtils";
import { readRuleWriteFailure } from "../permissionService";

const IMPACT_BODY = JSON.stringify({
  error: {
    code: "impact",
    message: "该规则会把 1 条基准命令从 ask/allow 变为 deny",
    impact: {
      mode: "auto",
      cases: [
        {
          toolName: "bash",
          command: "git status",
          before: "ask",
          after: "deny",
          degraded: true,
        },
      ],
      degradedCommands: ["git status"],
      degraded: true,
      note: "口径说明",
    },
  },
});

describe("formatError 保留结构化错误体", () => {
  it("JSON 错误体 ⇒ payload 为解析后的对象", () => {
    const error = formatError(409, IMPACT_BODY);
    expect(error.code).toBe(409);
    expect(error.payload).toEqual(JSON.parse(IMPACT_BODY));
  });

  it("非 JSON 错误体 ⇒ 不产出 payload（不编造结构）", () => {
    expect(formatError(500, "boom").payload).toBeUndefined();
    expect(formatError(500, undefined).payload).toBeUndefined();
  });
});

describe("readRuleWriteFailure — 按结构化字段分派", () => {
  it("409 impact ⇒ 取出 code / message / 变差命令清单", () => {
    const payload = formatError(409, IMPACT_BODY);
    const failure = readRuleWriteFailure(
      new HTTPClientError(payload.message, 409, payload),
    );
    expect(failure?.code).toBe("impact");
    expect(failure?.impact?.degraded).toBe(true);
    expect(failure?.impact?.degradedCommands).toEqual(["git status"]);
  });

  it("409 conflict ⇒ 带回冲突规则列表", () => {
    const body = JSON.stringify({
      error: {
        code: "conflict",
        message: "同键不同行为",
        conflicts: [
          {
            id: "r1",
            behavior: "allow",
            toolName: "bash",
            source: "user",
            priority: 0,
            createdAt: null,
            updatedAt: null,
          },
        ],
      },
    });
    const payload = formatError(409, body);
    const failure = readRuleWriteFailure(
      new HTTPClientError(payload.message, 409, payload),
    );
    expect(failure?.code).toBe("conflict");
    expect(failure?.conflicts?.map((rule) => rule.id)).toEqual(["r1"]);
    expect(failure?.impact).toBeUndefined();
  });

  it("非本仓结构化错误 ⇒ null（不做字符串匹配猜测）", () => {
    expect(readRuleWriteFailure(new Error("network down"))).toBeNull();
    expect(
      readRuleWriteFailure(
        new HTTPClientError("plain", 500, { code: 500, message: "plain" }),
      ),
    ).toBeNull();
    // 形似文案但没有 code 的 409：不认（避免误判为 impact 而二次确认写坏数据）
    expect(
      readRuleWriteFailure(
        new HTTPClientError("x", 409, { code: 409, message: "x", payload: {} }),
      ),
    ).toBeNull();
  });
});
