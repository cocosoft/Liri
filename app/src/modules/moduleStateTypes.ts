/**
 * moduleStateTypes — 模块初始化状态的**类型归属**（单一真源）
 *
 * 为什么单独成文件：`startupSurfaceProbe` 要读 `ModuleInitializer` 的状态结构，而
 * `ModuleInitializer` 又要在批次调度后懒加载探针。原先两边互相 import（探针侧是
 * **type-only import**、初始化器侧是 **动态 import**），`madge --circular` 把这两种边
 * 都计入 ⇒ CI `Static Checks` 的「循环依赖基线 = 0」必红（实测连续多轮）。
 *
 * 把状态词汇下沉到本文件后：`ModuleInitializer → 探针` 只剩**单向**边，环即消；
 * 而状态字面量（`'pending' | 'initializing' | 'initialized' | 'error'`）仍只有**一处**定义，
 * 不违反状态字面量 Register-or-Fail（CS02）的"词汇不重复"要求。
 */

/**
 * 模块初始化状态
 *
 * 由本文件独占定义 —— `ModuleInitializer`（写入/持有）与 `startupSurfaceProbe`（只读）
 * 都从这里取类型，任何一方都不得再抄一份联合类型。
 */
export interface ModuleInitializationState {
  // 模块初始化状态
  status: 'pending' | 'initializing' | 'initialized' | 'error';

  // 初始化开始时间
  startTime?: number;

  // 初始化结束时间
  endTime?: number;

  // 错误信息
  error?: Error;
}

/**
 * 模块初始化状态的**结构子集**（只读消费者复用）
 *
 * 探针只需要这四个字段；若它自己再写一份 `Pick<…, 'error'>` 就等于把状态词汇又抄一遍
 * （状态字面量棘轮会拦）。
 */
export type ModuleStateLike = Pick<
  ModuleInitializationState,
  'status' | 'startTime' | 'endTime' | 'error'
>;
