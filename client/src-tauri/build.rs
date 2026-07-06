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
    // Ensure binaries/node_modules directory exists with a placeholder file,
    // so the glob pattern "binaries/node_modules/**" in tauri.conf.json
    // resources always matches at least one file during build.
    let binaries_node_modules = "binaries/node_modules";
    let _ = std::fs::create_dir_all(binaries_node_modules);

    // Use a visible filename (not dot-prefixed) to avoid glob filtering
    let placeholder = format!("{}/_placeholder.txt", binaries_node_modules);
    let _ = std::fs::write(&placeholder, "Placeholder for build");

    println!("cargo:rerun-if-changed={}", binaries_node_modules);

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
