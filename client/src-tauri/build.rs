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

    let _ = std::fs::create_dir_all(binaries_node_modules);

    // Create placeholder to satisfy resources glob "binaries/**"
    let root_placeholder = format!("{}/_placeholder.txt", binaries_dir);
    let _ = std::fs::write(&root_placeholder, "Placeholder for Tauri build");
    let nm_placeholder = format!("{}/_placeholder.txt", binaries_node_modules);
    let _ = std::fs::write(&nm_placeholder, "Placeholder for binaries/node_modules");

    // Create sidecar placeholder with the exact name Tauri expects from
    // externalBin resolution (appends target triple + platform extension).
    // This prevents "glob pattern binaries/** path not found" during build.
    let target = std::env::var("TARGET").unwrap_or_default();
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let sidecar_name = format!("binaries/liri_coding-{}{}", target, ext);
    if !std::path::Path::new(&sidecar_name).exists() {
        let _ = std::fs::write(&sidecar_name, "");
    }

    println!("cargo:rerun-if-changed={}", binaries_dir);

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
