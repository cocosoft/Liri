// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 每轮助手回复耗时（`⏱ …`）写入判据回归 —— `shouldRecordTurnDuration`。
 *
 * 口径：**仅"正常完成"的轮次**写入 `durationMs`；abort / error / 异常结束都不写
 * （否则会把"未完成"误读为"已完成耗时"）。
 * 展示侧仅在 `message.durationMs !== undefined` 时渲染，故本判据是"显不显示"的唯一开关。
 */
import { describe, it, expect } from "vitest";
import { shouldRecordTurnDuration } from "../turnDuration";

/** 正常完成的基线输入（各用例只改一个维度） */
const OK = {
  streamStartTime: 1_700_000_000_000,
  abnormallyEnded: false,
  aborted: false,
  receivedError: false,
};

describe("shouldRecordTurnDuration（仅正常完成轮写耗时）", () => {
  it("正常完成 ⇒ true", () => {
    expect(shouldRecordTurnDuration(OK)).toBe(true);
  });

  it("用户/系统中止（aborted）⇒ false（不显示耗时，避免误读为已完成）", () => {
    expect(shouldRecordTurnDuration({ ...OK, aborted: true })).toBe(false);
  });

  it("已收到 error chunk（receivedError）⇒ false", () => {
    expect(shouldRecordTurnDuration({ ...OK, receivedError: true })).toBe(
      false,
    );
  });

  it("异常结束（连接中断 / 无内容兜底）⇒ false", () => {
    expect(shouldRecordTurnDuration({ ...OK, abnormallyEnded: true })).toBe(
      false,
    );
  });

  it("未记录流起点（streamStartTime = 0）⇒ false（宁缺勿误）", () => {
    expect(shouldRecordTurnDuration({ ...OK, streamStartTime: 0 })).toBe(false);
  });

  it("多条件叠加（abort + error）⇒ false（任一不满足即不写）", () => {
    expect(
      shouldRecordTurnDuration({
        ...OK,
        aborted: true,
        receivedError: true,
      }),
    ).toBe(false);
  });
});
