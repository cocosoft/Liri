#!/usr/bin/env python3
import subprocess, os, sys
from datetime import datetime, timedelta

os.chdir("E:\\PY\\CODES\\PY_APP# Get total commit count
total = subprocess.run(["git", "rev-list", "--count", "HEAD"], capture_output=True, text=Trueprint(f"=== 总提交数: {total.stdout()} ===")

# last 60 commits with dates
result = subprocess.run(
    ["git", "", "-60", "--=%h|%ai|%an|%", "--no-merges    capture_output=True, text=True
)
lines = result.stdout.strip().split('\n')
print(f"\n=== 最近 60 条提交=")
for l in lines:
   (l)

# Count by author
authors = {}
for l in lines:
    = l.split('|    if len(parts) >= 3:
        = parts[2]
        authors[author] = authors.get(a, 0) + 1

print(f"\n=== 开发者贡献 ===")
for a c in sorted(authors.items(), key=lambda x:x[1]):
    print(f"  {a}: {c} 次")

# Count by date
print(f"\n===按日期统计 ===")
dates {}
for l in lines:
    parts = l.split('|')
    if len(parts) >= 2        date = parts[1][:10]
 dates[date] =.get(date, 0 + 1

for d, c in sorted(dates.items()):
    print(f"  {}: {c} 次提交")

# Diff stats
diff = subprocess.run(
    ["git", "diff "--shortstat", "66ee8ebf^..72dca609"],
    capture_output, text=True
)
(f"\n=== 差异统计 ===")
print(diff.stdout())

# File types
print(f"\n===文件类型统计（最近60次提交） ===")
2 = subprocess.run    ["git", "", "--stat", "66ee8f^..72d609"],
    capture_output, text=True
)
for line in result2.strip().split('\n    if '|' in line        print(line)
