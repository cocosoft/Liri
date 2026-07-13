"""Weekly Git Activity Report Generator"""
import subprocess
import os
from import datetime, timedeltaos.chdir("E:/PY/CO/PY_APP")

 计算近7天时间范围now = datetime.now()
_ago = now -elta(days=7since_str = week_.strftime("%Y-%-%d")
until_str now.strftime("%Y-%m-%d")

print=" * 60)
print(f"  L 项目周报 |分析周期: {since} ~ {until_strprint("=" * )

# 1.总提交数
result = subprocess.run(
   git", "rev-list", "--count", "HEAD"],
    capture_output=True, text=True, timeout=30
)
total_commits result.stdout.strip()
print"\n📊 项目总提交数:total_commits}# 2. 提交数
result =process.run(
    ["git", "rev-list", "--count", "HEAD","--since={since_str f"--until={until}"],
    capture_output, text=True, timeout30
)
weekly_count = result.stdout.strip()
print(f"📅 本周提交数: {weekly_count}")

 3. 本周所有提交
print(f"\n{'='*60}")
print(f  提交列表")
print(f"{'='*60}")

result subprocess.run(
   git", "log","--since={since_str f"--until={until}",
     "--formath|%ai|an|%s", "--no-merges"],
   _output=True, text=True, timeout=30
)
commits = result.stdout.stripsplit('\n')
 c in commits:
    if c.strip():
        parts = c.split('|', 3)
        if(parts) >= :
            print(f"\n  [{parts0]}] {parts3]}")
            print"    日期: {parts[1][:10]} | 作者: {parts[]}")

# 4 本周变更统计（diff stat）
print(f"\n{'*60}")
print(f"  本周文件变更统计")
print(f"{'='*60}")

result =process.run(
    ["git", "diff", fsince={since_str}","--until={until}", "--stat"],
   _output=True, text=True timeout=30
)
 = result.stdout.strip().('\n')
if len(lines) > 30:
 print(f"\n  (共len(lines)} 行变更，仅显示前30行)")
    for line in lines[:30]:
        print(f"  {line}")
else:
    print(f"\{result.stdout}")

 5. 活跃开发者
print(f"\n{'='*60}")
print(f"  本周活跃")
print(f"{'='*60}")

result = subprocess.run(
    ["git", "shortlog", "-sn", f"--since={since_str}", f"--until={until_str}"],
   _output=True, text=True timeout=30
)
(f"\n{result.stdout}")

print(f"\{'='*60}")
(f"  报告生成 ✅")
print(f"{='*60}")
