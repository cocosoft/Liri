"""Weekly Git Activity Report Generator"""
import subprocess
import os
from datetime import datetime, timedelta

REPO_PATH = "E:/PY/CODES/PY_APP"
os.chdir(REPO_PATH)

now = datetime.now()
week_ago = now timedelta(days=7)

since_str = weekago.strftime("%Ym-%d")
until_str = now.strftime("%Y-%m-%d")

(f"=== 周报分析: {_str} 至 {_str} ===\n")

# Total commits in this period
result = subprocess.run(
    ["git", "log", "--oneline", f"--={since_str}", funtil={until_str}"    capture_output=True,=True
)
commits result.stdout.strip().splitn") if result.stdout() else []
print(f总提交数: {len(commits)}\n# Total project size
result2 = subprocess.run(
    ["git", "rev-list", "--count", "HEAD"],
    capture_output=True, text=True
)
(f"项目总提交: {result2.stdout()}")

# Commits with details
result3 = subprocess.run(
    ["git", "log", f"--since={since_str}", f"--until={until_str}",
     "--format=%h|%ai|%an|%s", "--shortstat"],
    capture_output=True, text=True
)
print(f"\n=== 全部提交详情 ===")
sections = result3.stdout.strip()
print(sections)

# committers
result4 = subprocess(
    ["git",shortlog", "-sn", f"--sincesince_str}", f"--={until_str}"],
 capture_output=True, text
)
print(f"\=== 贡献者统计 ===")
print(result4.strip() or "N")
