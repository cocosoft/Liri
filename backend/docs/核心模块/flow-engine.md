# FlowEngine - 流程引擎

## 概述

FlowEngine 提供流程编排能力，支持顺序执行、条件分支、并行执行和循环等流程控制模式。

## 基本用法

```typescript
import { FlowEngine } from "./core/flow-engine/engine.js";

const flow = new FlowEngine();

// 定义流程
flow.define("my-flow", [
  { id: "step1", action: "read_file", params: { path: "input.txt" } },
  { id: "step2", action: "process", depends: ["step1"] },
  { id: "step3", action: "write_file", params: { path: "output.txt" }, depends: ["step2"] }
]);

// 执行流程
const result = await flow.execute("my-flow");
```

## 流程控制

### 顺序执行

```typescript
flow.define("sequential", [
  { id: "step1", action: "task_a" },
  { id: "step2", action: "task_b", depends: ["step1"] },
  { id: "step3", action: "task_c", depends: ["step2"] }
]);
```

### 并行执行

```typescript
flow.define("parallel", [
  { id: "step1", action: "task_a" },
  { id: "step2", action: "task_b", depends: ["step1"] },
  // step3 和 step4 并行执行
  { id: "step3", action: "task_c", depends: ["step2"] },
  { id: "step4", action: "task_d", depends: ["step2"] }
]);
```

### 条件分支

```typescript
flow.define("conditional", [
  { id: "check", action: "validate" },
  {
    id: "branch",
    action: "condition",
    params: {
      if: { var: "check.result", eq: "valid" },
      then: "process_valid",
      else: "handle_invalid"
    }
  }
]);
```

## 事件监听

```typescript
flow.on("step:start", (event) => console.log(`Step ${event.stepId} started`));
flow.on("step:complete", (event) => console.log(`Step ${event.stepId} completed`));
flow.on("flow:complete", (event) => console.log(`Flow completed`));
```
