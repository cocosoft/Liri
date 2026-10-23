// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 沙箱权限类型（`SandboxPermission`）—— core 侧共享实现。
 *
 * 2026-10-01 由 `sandbox/SandboxTypes.ts` **下沉 core**（`R00-001` 倒挂收口 D-157）：
 * `permission`(infra) 的 `PermissionService.canAccessFile()` 需要本类型 ⇒ 构成
 * `permission -> sandbox` 倒挂。本实体是**零依赖的纯枚举**（无传递依赖）⇒ 属纯叶子可下沉；
 * 其运行时判定（`globalWorkspaceManager`）**不是**叶子，另经 `core/spi/ISandboxPort` 端口取得。
 *
 * 落点说明：置于 **core 模块根**（与 `core/paths.ts` / `core/pricing.ts` 同级），
 * 跨模块消费方按**相对 2 段路径**直连 —— 落 `core/**` 子目录会触发 R03-002
 * 「模块出口单一」（台账 D-61 实测）。
 *
 * 原位置 `sandbox/SandboxTypes.ts` 保留**同名转出**，全仓导出名与取值逐字不变。
 */

/**
 * 沙箱权限类型
 */
export enum SandboxPermission {
  /** 读取文件权限 */
  READ_FILE = 'read_file',
  /** 写入文件权限 */
  WRITE_FILE = 'write_file',
  /** 执行命令权限 */
  EXECUTE = 'execute',
  /** 网络访问权限 */
  NETWORK = 'network',
  /** 环境变量访问权限 */
  ENVIRONMENT = 'environment',
  /** 进程创建权限 */
  CREATE_PROCESS = 'create_process',
  /** 系统调用权限 */
  SYSTEM_CALL = 'system_call',
}
