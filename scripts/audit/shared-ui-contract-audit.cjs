const fs = require('node:fs');
const path = require('node:path');

const EXCLUDED_GLOBS = ['.archive', '.codex-tmp', '_tmp', '_codex_', '_deploy_'];
const EXCLUDED_DIR_NAMES = new Set([
  '.git',
  '.next',
  '.expo',
  'node_modules',
  'coverage',
  'dist',
  'build',
  'test-results',
]);

const CONTRACT_AUDIT_CATEGORIES = [
  {
    id: 'mobile-alerts',
    label: 'Mobile alert and confirm flows',
    roots: ['app', 'components', 'lib'],
    pattern: String.raw`Alert\.alert\(`,
  },
  {
    id: 'mobile-buttons',
    label: 'Mobile buttons and direct pressables',
    roots: ['app', 'components'],
    pattern: String.raw`<(Pressable|TouchableOpacity)\b|<Button\b`,
  },
  {
    id: 'modals-and-sheets',
    label: 'Modals, sheets, and action surfaces',
    roots: ['app', 'components', 'web/src'],
    pattern: String.raw`\bModal\b|BottomSheet|ActionSheet|Dialog|Sheet`,
  },
  {
    id: 'copy-link-open',
    label: 'Copy, external link, and file-open actions',
    roots: ['app', 'components', 'lib', 'web/src'],
    pattern: String.raw`Clipboard\.setStringAsync|Linking\.openURL|window\.open|openExternalUrl|navigator\.clipboard`,
  },
  {
    id: 'messenger-actions',
    label: 'Messenger long-press, action, and read affordances',
    roots: ['app', 'components', 'lib', 'web/src'],
    pattern: String.raw`onLongPress|openMessageActions|MessengerMessageActionSheet|messageUnreadCount|read_receipt|readReceipt`,
  },
  {
    id: 'roles-visibility',
    label: 'Role, permission, read-only, and visibility decisions',
    roots: ['app', 'components', 'hooks', 'lib', 'web/src'],
    pattern: String.raw`role|readOnly|isAdmin|isDeveloper|designer|manager|permission|visibility|can[A-Z]`,
  },
  {
    id: 'notifications-unread',
    label: 'Notification, unread, badge, and route behavior',
    roots: ['app', 'components', 'hooks', 'lib', 'web/src'],
    pattern: String.raw`notification|알림|unread|badge|checkpoint|route`,
  },
  {
    id: 'forms-validation',
    label: 'Forms, validation, and input behavior',
    roots: ['app', 'components', 'hooks', 'lib', 'web/src'],
    pattern: String.raw`TextInput|FormInput|useForm|Controller|zod|validate|validation|required|필수`,
  },
];

function shouldSkipPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.some((part) => EXCLUDED_DIR_NAMES.has(part))) return true;
  return EXCLUDED_GLOBS.some((glob) => normalized.includes(glob));
}

function listFiles(root, relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];

  const results = [];
  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || shouldSkipPath(current)) continue;

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (shouldSkipPath(absolute)) continue;
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs|json|md)$/.test(entry.name)) {
        results.push(absolute);
      }
    }
  }
  return results.sort();
}

function normalizeSamplePath(root, filePath, lineNumber) {
  const relative = path.relative(root, filePath).replace(/[\\/]+/g, '\\');
  return `${relative}:${lineNumber}`;
}

function scanCategory(root, category, sampleLimit) {
  const regex = new RegExp(category.pattern, 'g');
  const files = [...new Set(category.roots.flatMap((relativeRoot) => listFiles(root, relativeRoot)))];
  const samples = [];
  let hitCount = 0;
  let fileCount = 0;

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    const lines = source.split(/\r?\n/);
    let fileMatched = false;

    lines.forEach((line, index) => {
      regex.lastIndex = 0;
      const matches = line.match(regex);
      if (!matches) return;
      hitCount += matches.length;
      fileMatched = true;
      if (samples.length < sampleLimit) {
        samples.push(normalizeSamplePath(root, filePath, index + 1));
      }
    });

    if (fileMatched) fileCount += 1;
  }

  return {
    id: category.id,
    label: category.label,
    hitCount,
    fileCount,
    samples,
  };
}

function scanSharedUiContracts(options = {}) {
  const root = options.root ?? process.cwd();
  const sampleLimit = Number.isInteger(options.sampleLimit) ? options.sampleLimit : 8;

  return {
    repo: path.basename(root),
    excludedGlobs: EXCLUDED_GLOBS,
    categories: CONTRACT_AUDIT_CATEGORIES.map((category) => scanCategory(root, category, sampleLimit)),
  };
}

function formatInventoryMarkdown(inventory) {
  const lines = [
    `# Shared UI Action Audit: ${inventory.repo}`,
    '',
    '| Category | Files | Hits | Samples |',
    '| --- | ---: | ---: | --- |',
  ];
  for (const category of inventory.categories) {
    lines.push(
      `| ${category.label} | ${category.fileCount} | ${category.hitCount} | ${category.samples.join('<br>')} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

if (require.main === module) {
  const inventory = scanSharedUiContracts();
  const asJson = process.argv.includes('--json');
  process.stdout.write(asJson ? `${JSON.stringify(inventory, null, 2)}\n` : formatInventoryMarkdown(inventory));
}

module.exports = {
  CONTRACT_AUDIT_CATEGORIES,
  EXCLUDED_GLOBS,
  formatInventoryMarkdown,
  scanSharedUiContracts,
};
