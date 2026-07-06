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
    // 确保 directories exist with at least a placeholder so the glob pattern
    // "binaries/node_modules/**" in tauri.conf.json resources always matches
    let binaries_node_modules = "binaries/node_modules";
    let _ = std::fs::create_dir_all(binaries_node_modules);

    // 写入占位文件，确保空目录也能匹配 glob ** 模式
    let placeholder = format!("{}/.gitkeep", binaries_node_modules);
    let _ = std::fs::write(&placeholder, "");

    if std::path::Path::new(binaries_node_modules).exists() {
        println!("cargo:rerun-if-changed={}", binaries_node_modules);
    }

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
