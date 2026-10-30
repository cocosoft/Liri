/**
 * `useOnceOnMount` 单测：StrictMode 双调用下仍只执行一次。
 *
 * 背景（一致性核查 M9/M15）：`main.tsx` 开了 `React.StrictMode`，dev 下 effect
 * 会「挂载→卸载→再挂载」，首屏请求因此各发 2 次（`/v1/cron`、`/v1/channels`）。
 */
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { useOnceOnMount } from "../useOnceOnMount";

describe("useOnceOnMount", () => {
  it("StrictMode 双挂载 ⇒ 回调只执行一次", () => {
    const effect = vi.fn();
    renderHook(() => useOnceOnMount(effect), { wrapper: StrictMode });
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it("非 StrictMode ⇒ 同样只执行一次", () => {
    const effect = vi.fn();
    renderHook(() => useOnceOnMount(effect));
    expect(effect).toHaveBeenCalledTimes(1);
  });
});
