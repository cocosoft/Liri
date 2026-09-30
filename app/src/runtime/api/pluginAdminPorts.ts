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
 * 插件管理 —— **服务层端口**（C1「口径 C」：`plugins` 域；2026-09-30 台账 D-92）
 *
 * **为什么需要**：`infrastructure/http/handlers/` 下 3 个文件共 **13 处**动态导入 app 层
 * `@modules/plugins` / `@modules/plugins/marketplace` / `@modules/plugins/categories/PluginCategories`
 * （`service → app` 跨层引用，仅 `R00-003` 可见），涉及 `NpmDistributor` · `pluginMarketplace` ·
 * `pluginSystem` · `PLUGIN_CATEGORIES` 四个对象、**13 个方法**。按 D-89/D-91 先例（`skills` 域）：
 * **服务层声明端口（本文件）+ `CoreAPI` 只加 1 个取用方法**，app 对象引用与实例化**内聚在 `CoreAPIImpl`**。
 *
 * ⚠️ 端口**禁止引用 app 类型**（`R00-001` 连类型导入也计）：返回 app 对象处用 `unknown`，
 * 仅**调用方实际读取字段**的结果才给**最小投影 DTO**（本文件仅 2 处：安装结果 / 加载结果）。
 */

/**
 * 插件安装结果（调用方读取 `success` / `error` / `name` / `version`）
 * `success` 定**必填**：原代码 `if (!installResult.success)` 直接使用，无 `?.`/`??` 回退 ⇒ 据实定必填。
 */
export interface PluginInstallResultDto {
  success: boolean;
  error?: string | undefined;
  name?: string | undefined;
  version?: string | undefined;
}

/**
 * 插件加载结果（调用方只读 `success`）
 * `success` 定**必填**：原代码 `loaded = loadResult.success`（`loaded: boolean`）⇒ 据此定必填。
 */
export interface PluginLoadResultDto {
  success: boolean;
}

/** 插件管理端口（13 个方法 = 3 个 handler 文件的**实际调用面**，非 app 全量 API） */
export interface PluginAdminPort {
  // ---- 插件市场（`pluginMarketplace`）----
  searchMarket(params: {
    query: string;
    page: number;
    pageSize: number;
  }): Promise<unknown>;
  getMarketCategories(): Promise<unknown>;
  getMarketPlugin(pluginId: string): Promise<unknown>;
  getMarketPluginVersions(pluginId: string): Promise<unknown>;

  // ---- 插件系统（`pluginSystem`）----
  getPluginInfoList(): Promise<unknown>;
  checkPendingSdkTimeouts(): Promise<void>;
  getPendingSdkPlugins(): Promise<unknown>;
  loadPlugin(pluginId: string): Promise<PluginLoadResultDto>;
  /** 停用 + 卸载（**合成一个方法**：原实现把两步包在**同一个** try/catch 内 ⇒ 保持同语义） */
  stopAndUnloadPlugin(pluginId: string): Promise<void>;

  // ---- npm 分发（`new NpmDistributor()`；原实现每次**新建实例** ⇒ 端口同样按调用新建）----
  /** 已安装包列表（调用方逐条读 `name` / `version` / `installedAt` ⇒ 最小投影 DTO 数组） */
  listInstalledPackages(): Promise<
    Array<{
      name?: string | undefined;
      version?: string | undefined;
      installedAt?: unknown;
    }>
  >;
  installPackage(packageName: string): Promise<PluginInstallResultDto>;
  /** 返回"是否已移除"布尔（原实现读作 `removed` 直接回给 `success`） */
  removePackage(packageName: string): Promise<boolean>;

  // ---- 分类常量（`PLUGIN_CATEGORIES`）----
  getPluginCategories(): Promise<
    Record<string, { capability?: unknown; description?: unknown }>
  >;
}
