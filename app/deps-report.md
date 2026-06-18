# Liri 模块依赖分析报告

> 生成时间: 2026-06-18T07:45:14.426Z
> 扫描文件: 3648 个 .ts/.tsx 文件
> 识别模块: 78 个

## 1. 模块依赖矩阵

| 模块 | 依赖数 | 被依赖数 | 依赖列表 |
|------|--------|----------|----------|
| acp | 3 | 0 | error, monitoring, utils |
| agent | 9 | 4 | ai, config, core, error, monitoring, plugins, services, tools, utils |
| ai | 11 | 17 | channels, config, core, cost, error, monitoring, security, services, streaming, tools, utils |
| analytics | 3 | 3 | config, core, monitoring |
| auto-reply | 1 | 0 | error |
| bootstrap | 3 | 0 | config, core, error |
| bridge | 5 | 1 | channels, config, core, error, monitoring |
| buddy | 7 | 2 | chronos, config, core, error, monitoring, system, utils |
| cache | 4 | 5 | config, core, error, monitoring |
| channels | 8 | 7 | ai, config, core, error, monitoring, runtime, security, services |
| chat | 12 | 11 | ai, core, error, memory, monitoring, permission, security, services, session, tasks, tools, utils |
| chronos | 10 | 6 | buddy, channels, config, core, daemon, dream, error, knowledge, monitoring, tasks |
| cli | 19 | 1 | buddy, commands, components, config, constants, core, docs, error, hooks, ink, monitoring, oauth, query, session, skills, system, tools, ui, utils |
| commands | 18 | 5 | ai, channels, chronos, config, core, error, memory, monitoring, oauth, plugins, query, security, services, session, skills, tasks, tools, ui |
| common | 0 | 0 | — |
| components | 3 | 3 | core, error, monitoring |
| config | 3 | 44 | core, error, monitoring |
| constants | 7 | 4 | config, context, core, error, memory, services, skills |
| context | 6 | 3 | config, core, error, monitoring, security, utils |
| context-engine | 0 | 0 | — |
| core | 12 | 51 | ai, channels, cli, config, error, monitoring, plugin-sdk, runtime, security, session, utils, voice |
| cost | 5 | 2 | ai, core, error, hooks, monitoring |
| daemon | 6 | 1 | chronos, config, core, error, monitoring, tasks |
| diagnostics | 3 | 1 | config, core, monitoring |
| docs | 11 | 3 | cache, chat, commands, core, error, monitoring, plugins, skills, tools, ui, voice |
| dream | 4 | 1 | chronos, core, monitoring, tasks |
| entrypoints | 9 | 0 | ai, commands, config, core, infrastructure, monitoring, permission, tools, utils |
| error | 2 | 57 | config, monitoring |
| featureflags | 1 | 1 | core |
| flows | 0 | 0 | — |
| governance | 7 | 1 | core, error, hooks, monitoring, permission, sandbox, tools |
| healthcheck.ts | 1 | 0 | monitoring |
| hooks | 10 | 7 | bridge, chat, config, core, error, monitoring, permission, services, system, tools |
| i18n | 1 | 0 | config |
| index.ts | 2 | 0 | main.ts, utils |
| infrastructure | 13 | 5 | ai, analytics, channels, chat, components, config, core, cost, diagnostics, error, monitoring, runtime, sandbox |
| ink | 7 | 2 | chat, components, config, error, monitoring, runtime, utils |
| keybindings | 3 | 0 | core, error, monitoring |
| knowledge | 9 | 2 | ai, config, core, docs, error, monitoring, query, services, tools |
| lsp | 1 | 1 | error |
| main.ts | 5 | 1 | ai, core, infrastructure, monitoring, utils |
| mcp | 5 | 1 | config, error, monitoring, services, tools |
| media | 3 | 1 | core, error, monitoring |
| memory | 10 | 6 | ai, config, core, docs, error, hooks, monitoring, services, tools, utils |
| models | 0 | 0 | — |
| modules | 4 | 2 | core, error, monitoring, performance |
| monitor.ts | 1 | 0 | error |
| monitoring | 4 | 61 | config, core, error, tasks |
| oauth | 7 | 4 | config, core, error, infrastructure, monitoring, security, utils |
| performance | 5 | 1 | config, core, modules, monitoring, utils |
| permission | 6 | 7 | cache, config, core, error, monitoring, utils |
| plugin-sdk | 0 | 1 | — |
| plugins | 6 | 5 | config, core, error, monitoring, skills, types |
| promptSuggestion | 4 | 0 | config, core, error, monitoring |
| pyapp.ts | 1 | 0 | monitoring |
| query | 12 | 3 | agent, ai, analytics, chat, context, core, error, hooks, monitoring, services, session, tools |
| remote | 3 | 0 | config, error, monitoring |
| runtime | 9 | 5 | agent, ai, chat, config, core, error, monitoring, session, tools |
| sandbox | 4 | 4 | config, core, error, monitoring |
| scripts | 4 | 0 | commands, monitoring, types, utils |
| security | 6 | 10 | config, core, error, monitoring, permission, sandbox |
| services | 20 | 16 | ai, analytics, cache, chat, chronos, commands, config, constants, core, error, featureflags, infrastructure, memory, monitoring, oauth, permission, security, session, tools, utils |
| session | 7 | 9 | chat, config, core, error, monitoring, runtime, services |
| skills | 8 | 5 | config, context, core, error, monitoring, plugins, tools, utils |
| state | 2 | 1 | error, monitoring |
| streaming | 5 | 1 | error, monitoring, services, state, ui |
| subagent | 6 | 1 | chat, core, error, monitoring, tools, utils |
| subagents | 2 | 0 | monitoring, tools |
| system | 5 | 4 | config, error, infrastructure, monitoring, oauth |
| tasks | 10 | 7 | agent, ai, chat, chronos, config, constants, core, error, monitoring, tools |
| tools | 25 | 20 | agent, ai, cache, channels, chat, config, core, error, governance, hooks, knowledge, lsp, mcp, media, memory, modules, monitoring, permission, sandbox, security, services, session, subagent, tasks, utils |
| trace-recording | 2 | 0 | config, error |
| types | 1 | 3 | error |
| ui | 7 | 4 | config, core, error, hooks, ink, monitoring, system |
| utils | 11 | 21 | ai, cache, config, constants, core, error, monitoring, plugins, security, services, types |
| vim | 1 | 0 | monitoring |
| voice | 6 | 2 | core, memory, monitoring, services, session, tools |
| wizard | 1 | 0 | error |

## 2. 循环依赖检测

⚠️ 检测到 252 个循环依赖：

### 循环 1

```
error → config → error
```

### 循环 2

```
error → config → core → error
```

### 循环 3

```
monitoring → error → config → core → monitoring
```

### 循环 4

```
config → core → config
```

### 循环 5

```
core → utils → core
```

### 循环 6

```
config → core → utils → config
```

### 循环 7

```
error → config → core → utils → error
```

### 循环 8

```
monitoring → error → config → core → utils → monitoring
```

### 循环 9

```
core → utils → cache → core
```

### 循环 10

```
config → core → utils → cache → config
```

### 循环 11

```
monitoring → error → config → core → utils → cache → monitoring
```

### 循环 12

```
error → config → core → utils → cache → error
```

### 循环 13

```
error → config → core → utils → ai → error
```

### 循环 14

```
config → core → utils → ai → config
```

### 循环 15

```
monitoring → error → config → core → utils → ai → monitoring
```

### 循环 16

```
monitoring → error → config → core → utils → ai → tools → monitoring
```

### 循环 17

```
monitoring → error → config → core → utils → ai → tools → tasks → monitoring
```

### 循环 18

```
ai → tools → tasks → ai
```

### 循环 19

```
error → config → core → utils → ai → tools → tasks → error
```

### 循环 20

```
core → utils → ai → tools → tasks → core
```

### 循环 21

```
config → core → utils → ai → tools → tasks → config
```

### 循环 22

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → monitoring
```

### 循环 23

```
utils → ai → tools → tasks → chat → utils
```

### 循环 24

```
ai → tools → tasks → chat → ai
```

### 循环 25

```
tools → tasks → chat → tools
```

### 循环 26

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → monitoring
```

### 循环 27

```
error → config → core → utils → ai → tools → tasks → chat → services → error
```

### 循环 28

```
utils → ai → tools → tasks → chat → services → utils
```

### 循环 29

```
core → utils → ai → tools → tasks → chat → services → core
```

### 循环 30

```
config → core → utils → ai → tools → tasks → chat → services → config
```

### 循环 31

```
tools → tasks → chat → services → tools
```

### 循环 32

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → permission → monitoring
```

### 循环 33

```
error → config → core → utils → ai → tools → tasks → chat → services → permission → error
```

### 循环 34

```
utils → ai → tools → tasks → chat → services → permission → utils
```

### 循环 35

```
core → utils → ai → tools → tasks → chat → services → permission → core
```

### 循环 36

```
config → core → utils → ai → tools → tasks → chat → services → permission → config
```

### 循环 37

```
core → utils → ai → tools → tasks → chat → services → chronos → core
```

### 循环 38

```
config → core → utils → ai → tools → tasks → chat → services → chronos → config
```

### 循环 39

```
tasks → chat → services → chronos → tasks
```

### 循环 40

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → monitoring
```

### 循环 41

```
core → utils → ai → tools → tasks → chat → services → chronos → daemon → core
```

### 循环 42

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → daemon → error
```

### 循环 43

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → daemon → monitoring
```

### 循环 44

```
chronos → daemon → chronos
```

### 循环 45

```
config → core → utils → ai → tools → tasks → chat → services → chronos → daemon → config
```

### 循环 46

```
tasks → chat → services → chronos → daemon → tasks
```

### 循环 47

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → monitoring
```

### 循环 48

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → core
```

### 循环 49

```
ai → tools → tasks → chat → services → chronos → knowledge → ai
```

### 循环 50

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → error
```

### 循环 51

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → config
```

### 循环 52

```
services → chronos → knowledge → services
```

### 循环 53

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → monitoring
```

### 循环 54

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → error
```

### 循环 55

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → monitoring
```

### 循环 56

```
services → chronos → knowledge → docs → voice → services
```

### 循环 57

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → core
```

### 循环 58

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → monitoring
```

### 循环 59

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → core
```

### 循环 60

```
services → chronos → knowledge → docs → voice → session → services
```

### 循环 61

```
chat → services → chronos → knowledge → docs → voice → session → chat
```

### 循环 62

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → error
```

### 循环 63

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → config
```

### 循环 64

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → error
```

### 循环 65

```
tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → tools
```

### 循环 66

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → config
```

### 循环 67

```
chat → services → chronos → knowledge → docs → voice → session → runtime → chat
```

### 循环 68

```
session → runtime → session
```

### 循环 69

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → core
```

### 循环 70

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → monitoring
```

### 循环 71

```
ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → ai
```

### 循环 72

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → error
```

### 循环 73

```
ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → ai
```

### 循环 74

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → monitoring
```

### 循环 75

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → core
```

### 循环 76

```
tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → tools
```

### 循环 77

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → config
```

### 循环 78

```
utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → utils
```

### 循环 79

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → monitoring
```

### 循环 80

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → error
```

### 循环 81

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → core
```

### 循环 82

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → config
```

### 循环 83

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → core
```

### 循环 84

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → monitoring
```

### 循环 85

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → config
```

### 循环 86

```
plugins → skills → plugins
```

### 循环 87

```
utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → utils
```

### 循环 88

```
utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → context → utils
```

### 循环 89

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → context → config
```

### 循环 90

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → context → security → monitoring
```

### 循环 91

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → context → security → core
```

### 循环 92

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → context → security → config
```

### 循环 93

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → context → security → error
```

### 循环 94

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → context → security → sandbox → monitoring
```

### 循环 95

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → context → security → sandbox → error
```

### 循环 96

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → context → security → sandbox → config
```

### 循环 97

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → context → security → sandbox → core
```

### 循环 98

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → context → monitoring
```

### 循环 99

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → context → error
```

### 循环 100

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → context → core
```

### 循环 101

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → error
```

### 循环 102

```
tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → skills → tools
```

### 循环 103

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → session → runtime → agent → plugins → types → error
```

### 循环 104

```
services → chronos → knowledge → docs → voice → session → runtime → agent → services
```

### 循环 105

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → monitoring
```

### 循环 106

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → error
```

### 循环 107

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → core
```

### 循环 108

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → config
```

### 循环 109

```
utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → utils
```

### 循环 110

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → monitoring
```

### 循环 111

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → error
```

### 循环 112

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → error
```

### 循环 113

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → config
```

### 循环 114

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → error
```

### 循环 115

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → monitoring
```

### 循环 116

```
chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → chat
```

### 循环 117

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → components → monitoring
```

### 循环 118

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → components → core
```

### 循环 119

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → components → error
```

### 循环 120

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → core
```

### 循环 121

```
ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → ai
```

### 循环 122

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → config
```

### 循环 123

```
hooks → system → oauth → infrastructure → cost → hooks
```

### 循环 124

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → cost → monitoring
```

### 循环 125

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → cost → error
```

### 循环 126

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → cost → core
```

### 循环 127

```
ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → cost → ai
```

### 循环 128

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → analytics → monitoring
```

### 循环 129

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → analytics → config
```

### 循环 130

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → analytics → core
```

### 循环 131

```
services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → channels → services
```

### 循环 132

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → channels → monitoring
```

### 循环 133

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → channels → error
```

### 循环 134

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → channels → core
```

### 循环 135

```
ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → channels → ai
```

### 循环 136

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → channels → config
```

### 循环 137

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → diagnostics → config
```

### 循环 138

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → diagnostics → monitoring
```

### 循环 139

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → infrastructure → diagnostics → core
```

### 循环 140

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → monitoring
```

### 循环 141

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → error
```

### 循环 142

```
utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → utils
```

### 循环 143

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → config
```

### 循环 144

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → oauth → core
```

### 循环 145

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → system → monitoring
```

### 循环 146

```
services → chronos → knowledge → docs → voice → memory → hooks → services
```

### 循环 147

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → config
```

### 循环 148

```
chat → services → chronos → knowledge → docs → voice → memory → hooks → chat
```

### 循环 149

```
tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → tools
```

### 循环 150

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → bridge → error
```

### 循环 151

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → bridge → monitoring
```

### 循环 152

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → bridge → core
```

### 循环 153

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → bridge → config
```

### 循环 154

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → hooks → core
```

### 循环 155

```
ai → tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → ai
```

### 循环 156

```
services → chronos → knowledge → docs → voice → memory → services
```

### 循环 157

```
docs → voice → memory → docs
```

### 循环 158

```
tools → tasks → chat → services → chronos → knowledge → docs → voice → memory → tools
```

### 循环 159

```
tools → tasks → chat → services → chronos → knowledge → docs → voice → tools
```

### 循环 160

```
tools → tasks → chat → services → chronos → knowledge → docs → tools
```

### 循环 161

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → error
```

### 循环 162

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → core
```

### 循环 163

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → monitoring
```

### 循环 164

```
services → chronos → knowledge → docs → commands → services
```

### 循环 165

```
ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → query → ai
```

### 循环 166

```
services → chronos → knowledge → docs → commands → query → services
```

### 循环 167

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → query → monitoring
```

### 循环 168

```
tools → tasks → chat → services → chronos → knowledge → docs → commands → query → tools
```

### 循环 169

```
chat → services → chronos → knowledge → docs → commands → query → chat
```

### 循环 170

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → query → error
```

### 循环 171

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → query → core
```

### 循环 172

```
tools → tasks → chat → services → chronos → knowledge → docs → commands → tools
```

### 循环 173

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → config
```

### 循环 174

```
ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → ai
```

### 循环 175

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → ui → ink → config
```

### 循环 176

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → ui → ink → error
```

### 循环 177

```
utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → ui → ink → utils
```

### 循环 178

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → ui → ink → monitoring
```

### 循环 179

```
chat → services → chronos → knowledge → docs → commands → ui → ink → chat
```

### 循环 180

```
config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → ui → config
```

### 循环 181

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → ui → error
```

### 循环 182

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → ui → core
```

### 循环 183

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → commands → ui → monitoring
```

### 循环 184

```
tasks → chat → services → chronos → knowledge → docs → commands → tasks
```

### 循环 185

```
chronos → knowledge → docs → commands → chronos
```

### 循环 186

```
core → utils → ai → tools → tasks → chat → services → chronos → knowledge → docs → core
```

### 循环 187

```
chat → services → chronos → knowledge → docs → chat
```

### 循环 188

```
tools → tasks → chat → services → chronos → knowledge → tools
```

### 循环 189

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → error
```

### 循环 190

```
config → core → utils → ai → tools → tasks → chat → services → chronos → buddy → config
```

### 循环 191

```
error → config → core → utils → ai → tools → tasks → chat → services → chronos → buddy → error
```

### 循环 192

```
chronos → buddy → chronos
```

### 循环 193

```
core → utils → ai → tools → tasks → chat → services → chronos → buddy → core
```

### 循环 194

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → buddy → monitoring
```

### 循环 195

```
utils → ai → tools → tasks → chat → services → chronos → buddy → utils
```

### 循环 196

```
chronos → dream → chronos
```

### 循环 197

```
core → utils → ai → tools → tasks → chat → services → chronos → dream → core
```

### 循环 198

```
monitoring → error → config → core → utils → ai → tools → tasks → chat → services → chronos → dream → monitoring
```

### 循环 199

```
tasks → chat → services → chronos → dream → tasks
```

### 循环 200

```
chat → services → chat
```

### 循环 201

```
ai → tools → tasks → chat → services → ai
```

### 循环 202

```
core → utils → ai → tools → tasks → chat → services → featureflags → core
```

### 循环 203

```
error → config → core → utils → ai → tools → tasks → chat → services → constants → error
```

### 循环 204

```
config → core → utils → ai → tools → tasks → chat → services → constants → config
```

### 循环 205

```
services → constants → services
```

### 循环 206

```
core → utils → ai → tools → tasks → chat → services → constants → core
```

### 循环 207

```
core → utils → ai → tools → tasks → chat → core
```

### 循环 208

```
error → config → core → utils → ai → tools → tasks → chat → error
```

### 循环 209

```
tasks → chat → tasks
```

### 循环 210

```
tools → tasks → tools
```

### 循环 211

```
ai → tools → ai
```

### 循环 212

```
core → utils → ai → tools → core
```

### 循环 213

```
config → core → utils → ai → tools → config
```

### 循环 214

```
error → config → core → utils → ai → tools → error
```

### 循环 215

```
error → config → core → utils → ai → tools → modules → error
```

### 循环 216

```
monitoring → error → config → core → utils → ai → tools → modules → monitoring
```

### 循环 217

```
monitoring → error → config → core → utils → ai → tools → modules → performance → monitoring
```

### 循环 218

```
config → core → utils → ai → tools → modules → performance → config
```

### 循环 219

```
core → utils → ai → tools → modules → performance → core
```

### 循环 220

```
modules → performance → modules
```

### 循环 221

```
utils → ai → tools → modules → performance → utils
```

### 循环 222

```
core → utils → ai → tools → modules → core
```

### 循环 223

```
monitoring → error → config → core → utils → ai → tools → media → monitoring
```

### 循环 224

```
core → utils → ai → tools → media → core
```

### 循环 225

```
error → config → core → utils → ai → tools → media → error
```

### 循环 226

```
error → config → core → utils → ai → tools → lsp → error
```

### 循环 227

```
error → config → core → utils → ai → tools → subagent → error
```

### 循环 228

```
monitoring → error → config → core → utils → ai → tools → subagent → monitoring
```

### 循环 229

```
core → utils → ai → tools → subagent → core
```

### 循环 230

```
utils → ai → tools → subagent → utils
```

### 循环 231

```
tools → subagent → tools
```

### 循环 232

```
monitoring → error → config → core → utils → ai → tools → governance → monitoring
```

### 循环 233

```
core → utils → ai → tools → governance → core
```

### 循环 234

```
tools → governance → tools
```

### 循环 235

```
error → config → core → utils → ai → tools → governance → error
```

### 循环 236

```
config → core → utils → ai → tools → mcp → config
```

### 循环 237

```
monitoring → error → config → core → utils → ai → tools → mcp → monitoring
```

### 循环 238

```
error → config → core → utils → ai → tools → mcp → error
```

### 循环 239

```
tools → mcp → tools
```

### 循环 240

```
utils → ai → tools → utils
```

### 循环 241

```
core → utils → ai → core
```

### 循环 242

```
utils → ai → utils
```

### 循环 243

```
monitoring → error → config → core → utils → ai → streaming → monitoring
```

### 循环 244

```
error → config → core → utils → ai → streaming → error
```

### 循环 245

```
monitoring → error → config → core → utils → ai → streaming → state → monitoring
```

### 循环 246

```
error → config → core → utils → ai → streaming → state → error
```

### 循环 247

```
error → config → core → cli → error
```

### 循环 248

```
monitoring → error → config → core → cli → monitoring
```

### 循环 249

```
config → core → cli → config
```

### 循环 250

```
core → cli → core
```

### 循环 251

```
monitoring → error → config → monitoring
```

### 循环 252

```
monitoring → error → monitoring
```


## 3. 高耦合模块（被依赖数 ≥ 5）

| 模块 | 被依赖数 | 依赖方 |
|------|----------|--------|
| monitoring | 61 | acp, agent, ai, analytics, bridge, buddy, cache, channels, chat, chronos, cli, commands, components, config, context, core, cost, daemon, diagnostics, docs, dream, entrypoints, error, governance, healthcheck.ts, hooks, infrastructure, ink, keybindings, knowledge, main.ts, mcp, media, memory, modules, oauth, performance, permission, plugins, promptSuggestion, pyapp.ts, query, remote, runtime, sandbox, scripts, security, services, session, skills, state, streaming, subagent, subagents, system, tasks, tools, ui, utils, vim, voice |
| error | 57 | acp, agent, ai, auto-reply, bootstrap, bridge, buddy, cache, channels, chat, chronos, cli, commands, components, config, constants, context, core, cost, daemon, docs, governance, hooks, infrastructure, ink, keybindings, knowledge, lsp, mcp, media, memory, modules, monitor.ts, monitoring, oauth, permission, plugins, promptSuggestion, query, remote, runtime, sandbox, security, services, session, skills, state, streaming, subagent, system, tasks, tools, trace-recording, types, ui, utils, wizard |
| core | 51 | agent, ai, analytics, bootstrap, bridge, buddy, cache, channels, chat, chronos, cli, commands, components, config, constants, context, cost, daemon, diagnostics, docs, dream, entrypoints, featureflags, governance, hooks, infrastructure, keybindings, knowledge, main.ts, media, memory, modules, monitoring, oauth, performance, permission, plugins, promptSuggestion, query, runtime, sandbox, security, services, session, skills, subagent, tasks, tools, ui, utils, voice |
| config | 44 | agent, ai, analytics, bootstrap, bridge, buddy, cache, channels, chronos, cli, commands, constants, context, core, daemon, diagnostics, entrypoints, error, hooks, i18n, infrastructure, ink, knowledge, mcp, memory, monitoring, oauth, performance, permission, plugins, promptSuggestion, remote, runtime, sandbox, security, services, session, skills, system, tasks, tools, trace-recording, ui, utils |
| utils | 21 | acp, agent, ai, buddy, chat, cli, context, core, entrypoints, index.ts, ink, main.ts, memory, oauth, performance, permission, scripts, services, skills, subagent, tools |
| tools | 20 | agent, ai, chat, cli, commands, docs, entrypoints, governance, hooks, knowledge, mcp, memory, query, runtime, services, skills, subagent, subagents, tasks, voice |
| ai | 17 | agent, channels, chat, commands, core, cost, entrypoints, infrastructure, knowledge, main.ts, memory, query, runtime, services, tasks, tools, utils |
| services | 16 | agent, ai, channels, chat, commands, constants, hooks, knowledge, mcp, memory, query, session, streaming, tools, utils, voice |
| chat | 11 | docs, hooks, infrastructure, ink, query, runtime, services, session, subagent, tasks, tools |
| security | 10 | ai, channels, chat, commands, context, core, oauth, services, tools, utils |
| session | 9 | chat, cli, commands, core, query, runtime, services, tools, voice |
| channels | 7 | ai, bridge, chronos, commands, core, infrastructure, tools |
| hooks | 7 | cli, cost, governance, memory, query, tools, ui |
| permission | 7 | chat, entrypoints, governance, hooks, security, services, tools |
| tasks | 7 | chat, chronos, commands, daemon, dream, monitoring, tools |
| chronos | 6 | buddy, commands, daemon, dream, services, tasks |
| memory | 6 | chat, commands, constants, services, tools, voice |
| cache | 5 | docs, permission, services, tools, utils |
| commands | 5 | cli, docs, entrypoints, scripts, services |
| infrastructure | 5 | entrypoints, main.ts, oauth, services, system |
| plugins | 5 | agent, commands, docs, skills, utils |
| runtime | 5 | channels, core, infrastructure, ink, session |
| skills | 5 | cli, commands, constants, docs, plugins |

## 4. 零依赖模块（叶节点）

共 5 个叶节点模块：

- common
- context-engine
- flows
- models
- plugin-sdk
