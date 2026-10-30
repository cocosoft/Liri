/**
 * C2（2026-10-30）：assistant 正文 `{"data":"…"}` 窄包装解包的单测。
 *
 * 真机依据（一致性核查 §8.1）：某会话最近 30 条 assistant 中 18 条 content 为
 * `{"data":"…工具输出…"}`，气泡原样铺开 JSON。解包**只在渲染侧**做，且必须窄：
 * 合法 JSON（多字段 / 非字符串 data / 数组）一律不解包。
 */
import { describe, expect, it } from "vitest";

import {
  JSON_PAYLOAD_MAX_CHARS,
  unwrapJsonDataPayload,
} from "../jsonPayloadText";

describe("unwrapJsonDataPayload：窄包装解包", () => {
  it('`{"data":"…"}` ⇒ 取内层字符串（转义换行还原为真换行）', () => {
    expect(unwrapJsonDataPayload('{"data":"第一行\\n第二行"}')).toBe(
      "第一行\n第二行",
    );
  });

  it("允许前后空白", () => {
    expect(unwrapJsonDataPayload('  \n {"data":"x"} \n ')).toBe("x");
  });

  it("多字段 / 数组 / 非字符串 data ⇒ 不解包（合法 JSON 原样保留）", () => {
    expect(unwrapJsonDataPayload('{"data":"x","other":1}')).toBeNull();
    expect(unwrapJsonDataPayload('{"data":{"a":1}}')).toBeNull();
    expect(unwrapJsonDataPayload("[1,2]")).toBeNull();
  });

  it("空 data / 纯空白 data ⇒ 不解包（无正文可显示）", () => {
    expect(unwrapJsonDataPayload('{"data":""}')).toBeNull();
    expect(unwrapJsonDataPayload('{"data":"   "}')).toBeNull();
  });

  it("非法 JSON / 普通文本 ⇒ null", () => {
    expect(unwrapJsonDataPayload('{"data":"未闭合')).toBeNull();
    expect(unwrapJsonDataPayload("普通正文")).toBeNull();
    expect(unwrapJsonDataPayload(undefined)).toBeNull();
  });

  it("超长（> 上限）⇒ 不解析（避免大字符串卡帧）", () => {
    const huge = `{"data":"${"x".repeat(JSON_PAYLOAD_MAX_CHARS)}"}`;
    expect(unwrapJsonDataPayload(huge)).toBeNull();
  });
});
