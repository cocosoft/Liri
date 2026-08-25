# landlock-run native helper（C11）

`app/src/sandbox/landlock/` 的 TS 模块通过本 helper 在 Landlock 域中执行命令。
源码移植自 deepseek-harness `native/landlock-run`（MIT），扩展至 **MAX_ABI 10**：

| ABI | 本 helper 支持 |
|-----|----------------|
| v1-v5 | FS 全位（EXECUTE..IOCTL_DEV），`--ro`/`--rw` |
| v4 | NET `BIND_TCP`/`CONNECT_TCP`（`--net-connect tcp`） |
| v6 SCOPE / v7 LOG / v9 RESOLVE_UNIX | **未请求**（当前策略不使用；`scoped`/`resolve` 字段置零） |
| v8 | `LANDLOCK_RESTRICT_SELF_TSYNC`（`--tsync` 显式请求；单线程 helper 默认 flags=0，见方案 §3.3） |
| v10 | NET `BIND/CONNECT/SEND/RECV_UDP`（`--net-connect udp`） |

## 构建（需 Linux 内核 5.13+ 环境）

```sh
# 静态链接 musl（或 glibc 亦可，运行验证用）
cc -static -O2 -o landlock-run main.c
# 分发到 PATH 或经 runWithLandlock 的 helperPath 指定
```

> **注意**：本文件在 Windows 上无法编译验证。落地步骤见方案 §9.9：
> 1. Linux 编译 + `--probe` 实测（full/partial 输出）
> 2. `landlock.e2e.ts` 权限矩阵（read/write/exec deny、partial ABI）
> 3. partial 归因测试（postmortem 0004：仅 exit 125 判定沙箱初始化失败）

## CLI 契约（与 `../runWithLandlock.ts` 对齐）

```
landlock-run [--ro <path>]... [--rw <path>]... [--net-connect <tcp|udp>]... [--tsync] -- <argv>...
landlock-run --probe
```

- `--ro`：路径下 read+execute；`--rw`：路径下完整 FS 访问
- `--net-connect tcp|udp`：授予对应协议 CONNECT（bind 默认拒绝）
- fail-closed：任何初始化失败 → **exit 125** + stderr `landlock-run: <detail>`
- partial：旧 ABI 上部分生效 → stderr `landlock-run: partial enforcement ...`（非致命）
- `--probe`：构建最大 ruleset 实测内核是否允许 enforce，stdout 输出
  `landlock: fully enforced` / `landlock: partially enforced (older ABI)`
