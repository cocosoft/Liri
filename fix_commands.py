import os

src = r'e:\PY\CODES\PY_APP\app\src'
patterns = [
    'manager/CommandManager.js',
    'registry/CommandRegistry.js',
    'registry/index.js',
    'history/CommandHistoryManager.js',
    'history/EnhancedCommandHistory.js',
    'completion/CommandCompletionManager.js',
    'framework/CommandCatalog.js',
    'parser/CommandParser.js',
    'constants/CommandConstants.js',
    'index.js',
    'loader/CommandLoader.js',
]

count = 0
for root, dirs, files in os.walk(src):
    if 'node_modules' in root:
        continue
    for f in files:
        if not (f.endswith('.ts') or f.endswith('.tsx')):
            continue
        fp = os.path.join(root, f)
        try:
            with open(fp, 'r', encoding='utf-8') as fh:
                content = fh.read()
            new_content = content
            for sub in patterns:
                old = "from '@modules/commands/" + sub + "'"
                new = "from '@modules/commands'"
                if old in new_content:
                    new_content = new_content.replace(old, new)
                    count += 1
            if new_content != content:
                with open(fp, 'w', encoding='utf-8') as fh:
                    fh.write(new_content)
        except Exception as e:
            print(f"Error processing {fp}: {e}")

print(f"Replaced: {count}")
