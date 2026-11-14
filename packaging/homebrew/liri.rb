# 由 scripts/gen-package-manifests.ts 生成，勿手改；提交目标是 openliri/homebrew-tap。
class Liri < Formula
  desc "Liri — AI 私人助手（CLI）"
  homepage "https://openliri.com"
  url "https://github.com/openliri/Liri/releases/download/v0.6.1/liri-cli-0.6.1.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"
  version "0.6.1"

  depends_on "bun"

  def install
    libexec.install "main.js"
    (bin/"liri").write <<~SH
      #!/bin/sh
      exec "#{Formula["bun"].opt_bin}/bun" "#{libexec}/main.js" "$@"
    SH
    chmod 0755, bin/"liri"
  end

  test do
    assert_match "Liri", shell_output("#{bin}/liri --version 2>&1", 0)
  end
end
