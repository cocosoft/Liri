# Liri 模块依赖分析报告

> 生成时间: 2026-05-11T17:27:19.185Z
> 扫描文件: 2258 个 .ts/.tsx 文件
> 识别模块: 63 个

## 1. 模块依赖矩阵

| 模块 | 依赖数 | 被依赖数 | 依赖列表 |
|------|--------|----------|----------|
| agent | 7 | 1 | ai, config, core, error, monitoring, plugins, utils |
| ai | 5 | 7 | config, core, error, query, tools |
| analytics | 2 | 2 | core, monitoring |
| bootstrap | 0 | 0 | — |
| bridge | 6 | 1 | error, infrastructure, mcp, monitoring, oauth, streaming |
| buddy | 4 | 1 | config, core, error, utils |
| cache | 2 | 4 | error, monitoring |
| chat | 5 | 7 | ai, error, monitoring, permission, security |
| chronos | 2 | 4 | error, monitoring |
| cli | 11 | 1 | buddy, core, docs, error, hooks, ink, monitoring, skills, tools, ui, utils |
| commands | 9 | 4 | core, error, memory, monitoring, oauth, security, services, session, tools |
| common | 0 | 0 | — |
| components | 0 | 0 | — |
| config | 2 | 6 | error, monitoring |
| constants | 1 | 2 | error |
| context | 3 | 2 | error, monitoring, utils |
| core | 9 | 11 | ai, chat, cli, error, infrastructure, monitoring, oauth, tools, utils |
| cost | 4 | 1 | cache, error, hooks, monitoring |
| daemon | 3 | 0 | chronos, error, monitoring |
| diagnostics | 1 | 0 | monitoring |
| docs | 9 | 1 | cache, commands, error, monitoring, plugins, services, skills, tools, ui |
| entrypoints | 6 | 0 | commands, config, monitoring, permission, tools, utils |
| error | 2 | 37 | monitoring, utils |
| featureflags | 0 | 1 | — |
| governance | 6 | 1 | error, hooks, monitoring, permission, sandbox, tools |
| healthcheck.ts | 0 | 0 | — |
| hooks | 9 | 6 | bridge, chat, config, cost, error, monitoring, permission, services, tools |
| index.ts | 2 | 0 | main.ts, utils |
| infrastructure | 1 | 5 | utils |
| ink | 1 | 2 | utils |
| keybindings | 2 | 0 | error, monitoring |
| lsp | 1 | 1 | error |
| main.ts | 3 | 1 | infrastructure, monitoring, utils |
| mcp | 9 | 4 | error, featureflags, infrastructure, monitoring, oauth, plugins, security, tools, utils |
| memory | 5 | 2 | core, error, hooks, monitoring, utils |
| models | 0 | 0 | — |
| modules | 1 | 1 | monitoring |
| monitor.ts | 0 | 0 | — |
| monitoring | 1 | 39 | error |
| oauth | 2 | 4 | error, infrastructure |
| performance | 2 | 0 | monitoring, utils |
| permission | 3 | 7 | error, monitoring, utils |
| permissions | 0 | 0 | — |
| plugins | 4 | 5 | error, monitoring, types, utils |
| promptSuggestion | 1 | 0 | error |
| query | 9 | 1 | ai, analytics, chat, context, error, hooks, monitoring, services, session |
| remote | 2 | 0 | error, monitoring |
| sandbox | 1 | 3 | monitoring |
| scripts | 2 | 0 | commands, utils |
| security | 4 | 4 | error, monitoring, permission, sandbox |
| services | 15 | 7 | ai, analytics, cache, chat, chronos, commands, core, error, mcp, memory, monitoring, permission, session, tools, utils |
| session | 1 | 4 | error |
| skills | 9 | 2 | chronos, context, error, mcp, monitoring, plugins, tools, types, utils |
| streaming | 2 | 1 | error, services |
| subagent | 4 | 1 | chat, error, monitoring, tools |
| subagents | 2 | 0 | monitoring, tools |
| task | 0 | 0 | — |
| tasks | 3 | 1 | chat, constants, monitoring |
| tools | 22 | 13 | agent, ai, cache, chat, chronos, config, core, error, governance, hooks, lsp, mcp, modules, monitoring, permission, sandbox, security, services, session, subagent, tasks, utils |
| types | 0 | 3 | — |
| ui | 2 | 2 | core, ink |
| utils | 8 | 20 | ai, constants, core, error, monitoring, plugins, services, types |
| vim | 1 | 0 | monitoring |

## 2. 循环依赖检测

⚠️ 检测到 67 个循环依赖：

### 循环 1

```
error → utils → error
```

### 循环 2

```
error → utils → monitoring → error
```

### 循环 3

```
ai → error → utils → ai
```

### 循环 4

```
ai → error → utils → core → tools → ai
```

### 循环 5

```
agent → ai → error → utils → core → tools → agent
```

### 循环 6

```
error → utils → core → tools → security → error
```

### 循环 7

```
utils → core → tools → security → permission → utils
```

### 循环 8

```
error → utils → core → tools → security → permission → error
```

### 循环 9

```
error → utils → core → tools → error
```

### 循环 10

```
error → utils → core → tools → chat → error
```

### 循环 11

```
ai → error → utils → core → tools → chat → ai
```

### 循环 12

```
error → utils → core → tools → session → error
```

### 循环 13

```
error → utils → core → tools → cache → error
```

### 循环 14

```
error → utils → core → tools → chronos → error
```

### 循环 15

```
error → utils → core → tools → config → error
```

### 循环 16

```
core → tools → core
```

### 循环 17

```
error → utils → core → tools → lsp → error
```

### 循环 18

```
utils → core → tools → mcp → oauth → infrastructure → utils
```

### 循环 19

```
error → utils → core → tools → mcp → oauth → error
```

### 循环 20

```
error → utils → core → tools → mcp → error
```

### 循环 21

```
utils → core → tools → mcp → utils
```

### 循环 22

```
tools → mcp → tools
```

### 循环 23

```
error → utils → core → tools → mcp → plugins → error
```

### 循环 24

```
utils → core → tools → mcp → plugins → utils
```

### 循环 25

```
error → utils → core → tools → tasks → constants → error
```

### 循环 26

```
error → utils → core → tools → subagent → error
```

### 循环 27

```
tools → subagent → tools
```

### 循环 28

```
error → utils → core → tools → governance → hooks → error
```

### 循环 29

```
hooks → cost → hooks
```

### 循环 30

```
error → utils → core → tools → governance → hooks → cost → error
```

### 循环 31

```
utils → core → tools → governance → hooks → services → utils
```

### 循环 32

```
tools → governance → hooks → services → tools
```

### 循环 33

```
ai → error → utils → core → tools → governance → hooks → services → ai
```

### 循环 34

```
error → utils → core → tools → governance → hooks → services → error
```

### 循环 35

```
error → utils → core → tools → governance → hooks → services → commands → error
```

### 循环 36

```
services → commands → services
```

### 循环 37

```
tools → governance → hooks → services → commands → tools
```

### 循环 38

```
core → tools → governance → hooks → services → commands → core
```

### 循环 39

```
core → tools → governance → hooks → services → commands → memory → core
```

### 循环 40

```
utils → core → tools → governance → hooks → services → commands → memory → utils
```

### 循环 41

```
hooks → services → commands → memory → hooks
```

### 循环 42

```
error → utils → core → tools → governance → hooks → services → commands → memory → error
```

### 循环 43

```
core → tools → governance → hooks → services → analytics → core
```

### 循环 44

```
core → tools → governance → hooks → services → core
```

### 循环 45

```
tools → governance → hooks → tools
```

### 循环 46

```
error → utils → core → tools → governance → hooks → bridge → error
```

### 循环 47

```
error → utils → core → tools → governance → hooks → bridge → streaming → error
```

### 循环 48

```
tools → governance → tools
```

### 循环 49

```
error → utils → core → tools → governance → error
```

### 循环 50

```
utils → core → tools → utils
```

### 循环 51

```
error → utils → core → error
```

### 循环 52

```
utils → core → utils
```

### 循环 53

```
utils → core → cli → ui → ink → utils
```

### 循环 54

```
core → cli → ui → core
```

### 循环 55

```
utils → core → cli → skills → context → utils
```

### 循环 56

```
error → utils → core → cli → skills → context → error
```

### 循环 57

```
error → utils → core → cli → skills → error
```

### 循环 58

```
utils → core → cli → skills → utils
```

### 循环 59

```
utils → core → cli → utils
```

### 循环 60

```
error → utils → core → cli → error
```

### 循环 61

```
error → utils → core → cli → docs → error
```

### 循环 62

```
core → cli → core
```

### 循环 63

```
core → cli → buddy → core
```

### 循环 64

```
error → utils → core → cli → buddy → error
```

### 循环 65

```
utils → core → cli → buddy → utils
```

### 循环 66

```
ai → error → utils → core → ai
```

### 循环 67

```
ai → query → ai
```


## 3. 高耦合模块（被依赖数 ≥ 5）

| 模块 | 被依赖数 | 依赖方 |
|------|----------|--------|
| monitoring | 39 | agent, analytics, bridge, cache, chat, chronos, cli, commands, config, context, core, cost, daemon, diagnostics, docs, entrypoints, error, governance, hooks, keybindings, main.ts, mcp, memory, modules, performance, permission, plugins, query, remote, sandbox, security, services, skills, subagent, subagents, tasks, tools, utils, vim |
| error | 37 | agent, ai, bridge, buddy, cache, chat, chronos, cli, commands, config, constants, context, core, cost, daemon, docs, governance, hooks, keybindings, lsp, mcp, memory, monitoring, oauth, permission, plugins, promptSuggestion, query, remote, security, services, session, skills, streaming, subagent, tools, utils |
| utils | 20 | agent, buddy, cli, context, core, entrypoints, error, index.ts, infrastructure, ink, main.ts, mcp, memory, performance, permission, plugins, scripts, services, skills, tools |
| tools | 13 | ai, cli, commands, core, docs, entrypoints, governance, hooks, mcp, services, skills, subagent, subagents |
| core | 11 | agent, ai, analytics, buddy, cli, commands, memory, services, tools, ui, utils |
| ai | 7 | agent, chat, core, query, services, tools, utils |
| chat | 7 | core, hooks, query, services, subagent, tasks, tools |
| permission | 7 | chat, entrypoints, governance, hooks, security, services, tools |
| services | 7 | commands, docs, hooks, query, streaming, tools, utils |
| config | 6 | agent, ai, buddy, entrypoints, hooks, tools |
| hooks | 6 | cli, cost, governance, memory, query, tools |
| infrastructure | 5 | bridge, core, main.ts, mcp, oauth |
| plugins | 5 | agent, docs, mcp, skills, utils |

## 4. 零依赖模块（叶节点）

共 10 个叶节点模块：

- bootstrap
- common
- components
- featureflags
- healthcheck.ts
- models
- monitor.ts
- permissions
- task
- types
