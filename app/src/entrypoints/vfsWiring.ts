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
 * AI-VFS 装配（**组合根**）—— 2026-10-08 「AI-VFS 只读试点」
 * （`.trae/specs/ai-vfs-readonly-pilot.md` v1.1）。
 *
 * 为什么放在 `entrypoints/`：挂载点→驱动的映射是**部署期装配事实**，不是业务逻辑；
 * 由组合根集中注册（同 `entrypoints/spiWiring.ts` 的手法）⇒ 业务模块内**不自建**注册表
 * （`VfsMountRegistry` 为唯一注册面）。`vfs` 与 `tools` 同属 app 层，此处动态导入
 * ⇒ 与 `main.ts` 的启动时机不变。
 *
 * 时机：在 `bootstrap()` 的 SPI 注入点（`main.ts` 的 `registerSpis` 回调）调用 ⇒
 * **早于任何工具执行**（`read_vfs` / `list_vfs` / `stat_vfs` 依赖挂载已注册）。
 */

/**
 * 注册内置 VFS 挂载点。
 *
 * 幂等：若同名 scheme 已注册（如热重载后重复调用）则跳过 —— 注册表本身对**重复 scheme**
 * 明确抛错（`VFS_CONFLICT`），本装配面据此先探测，避免把幂等装配变成启动失败。
 */
export async function registerVfsMounts(): Promise<void> {
  const { vfsMountRegistry, DevDocsDriver } = await import('@modules/vfs');
  if (vfsMountRegistry.has('dev_docs')) return;
  vfsMountRegistry.registerMount('dev_docs', new DevDocsDriver());
}
