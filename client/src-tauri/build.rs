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

fn main() {
    let binaries_dir = "binaries";
    let binaries_node_modules = "binaries/node_modules";

    // 确保 binaries/ 目录结构存在（CI 环境 gitignore 后不会有此目录）
    if let Err(e) = std::fs::create_dir_all(binaries_node_modules) {
        println!("cargo:warning=Failed to create binaries/ dirs: {}", e);
    }

    // 创建占位文件，确保 Tauri resources glob "binaries/**" 始终能匹配到文件
    // 在 CI 环境中，binaries/ 被 gitignore，sidecar 由 workflow 构建后复制进来；
    // 但 build.rs 先于 bundler 运行，必须确保此时目录非空
    let placeholder_content = "Tauri build placeholder — safe to overwrite";
    let placeholder_files = [
        format!("{}/placeholder.txt", binaries_dir),
        format!("{}/placeholder.txt", binaries_node_modules),
    ];
    for pf in &placeholder_files {
        if let Err(e) = std::fs::write(pf, placeholder_content) {
            println!("cargo:warning=Failed to write placeholder '{}': {}", pf, e);
        }
    }

    // 创建 sidecar 占位文件，与 Tauri externalBin 命名规则一致
    // Tauri 会自动在 externalBin 名称后追加 target triple + 平台扩展名
    let target = std::env::var("TARGET").unwrap_or_default();
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let sidecar_name = format!("{}/liri_coding-{}{}", binaries_dir, target, ext);

    if !std::path::Path::new(&sidecar_name).exists() {
        if let Err(e) = std::fs::write(&sidecar_name, "") {
            println!("cargo:warning=Failed to create sidecar placeholder '{}': {}", sidecar_name, e);
        } else {
            println!("cargo:warning=Created sidecar placeholder: {}", sidecar_name);
        }
    }

    println!("cargo:rerun-if-changed={}", binaries_dir);

    // 如果 sidecar 已存在（CI 中 workflow 已复制），单独监控其变化
    // 确保后续 cargo 构建能检测到 sidecar 更新
    if std::path::Path::new(&sidecar_name).exists() {
        println!("cargo:rerun-if-changed={}", sidecar_name);
    }

    // 诊断输出：列出 binaries/ 目录内容，便于 CI 排查 glob 匹配问题
    println!(
        "cargo:warning=binaries/ contents: placeholder.txt={}, sidecar={}",
        std::path::Path::new(&format!("{}/placeholder.txt", binaries_dir)).exists(),
        std::path::Path::new(&sidecar_name).exists()
    );

    #[cfg(windows)]
    {
        std::thread::Builder::new()
            .stack_size(8 * 1024 * 1024) // 8 MB stack
            .spawn(|| tauri_build::build())
            .expect("Failed to spawn build thread")
            .join()
            .expect("Build thread panicked");
    }

    #[cfg(not(windows))]
    {
        tauri_build::build()
    }
}
