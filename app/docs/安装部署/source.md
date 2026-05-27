# 源码编译

## 前提条件

- Rust 工具链 (用于原生模块)
- Cargo（Rust 包管理器）
- Bun 或 Node.js

## 编译原生模块

```bash
cd native

# 构建原生模块
cargo build --release

# 运行测试
cargo test
```

### 原生模块列表

| 模块 | 说明 | 路径 |
|------|------|------|
| bash_ast | Bash AST 解析器 | `native/src/bash_ast.rs` |
| security | 安全验证模块 | `native/src/security.rs` |
| context | 上下文处理 | `native/src/context.rs` |
| json_util | JSON 工具函数 | `native/src/json_util.rs` |

## 构建应用

```bash
cd backend

# 安装依赖
bun install

# 构建 TypeScript
bun run build

# 构建 Docker 镜像
docker build -t py-app:latest .
```

## 开发模式构建

```bash
# 监听模式（自动重新编译）
bun run dev

# 类型检查
npx tsc --noEmit

# 运行测试
bun test
```

## 交叉编译

### Windows 目标

```bash
# 在 Linux/macOS 上交叉编译 Windows 原生模块
cargo build --release --target x86_64-pc-windows-gnu
```

### macOS 目标

```bash
# 交叉编译 macOS 通用二进制
cargo build --release --target x86_64-apple-darwin
cargo build --release --target aarch64-apple-darwin
lipo -create -output universal target/release/libpy_app.a \
  target/x86_64-apple-darwin/release/libpy_app.a \
  target/aarch64-apple-darwin/release/libpy_app.a
```

## 验证构建

```bash
# 运行测试套件
bun test

# 类型检查
npx tsc --noEmit

# 启动验证
bun run start --help
```
