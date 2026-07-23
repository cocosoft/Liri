// MIT License
// Copyright (c) 2026 190615273@qq.com

/// PY_APP Rust native FFI module
/// Provides safe context compression and token estimation via C ABI.
///
/// All exported functions are wrapped with catch_unwind to prevent
/// panics from crashing the Node.js process.
pub mod context;
pub mod error;
pub mod token_counter;
