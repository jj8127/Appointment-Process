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

const FUNCTION_AUDIT_CATEGORIES = [
  {
    id: 'formatters-normalizers',
    label: 'Formatters and normalizers',
    roots: ['app', 'components', 'hooks', 'lib', 'web/src'],
    pattern: String.raw`\b(?:function|const|export\s+(?:function|const))\s+(?:format|normalize)[A-Z][A-Za-z0-9_]*`,
  },
  {
    id: 'builders-resolvers',
    label: 'Builders and resolvers',
    roots: ['app', 'components', 'hooks', 'lib', 'web/src'],
    pattern: String.raw`\b(?:function|const|export\s+(?:function|const))\s+(?:build|resolve|derive)[A-Z][A-Za-z0-9_]*`,
  },
  {
    id: 'predicates-permissions',
    label: 'Predicates and permission checks',
    roots: ['app', 'components', 'hooks', 'lib', 'web/src'],
    pattern: String.raw`\b(?:function|const|export\s+(?:function|const))\s+(?:can|has|is|should)[A-Z][A-Za-z0-9_]*`,
  },
  {
    id: 'mappers-converters',
    label: 'Mappers and converters',
    roots: ['app', 'components', 'hooks', 'lib', 'web/src'],
    pattern: String.raw`\b(?:function|const|export\s+(?:function|const))\s+(?:map|to)[A-Z][A-Za-z0-9_]*`,
  },
  {
    id: 'message-display-helpers',
    label: 'Message display helpers',
    roots: ['app', 'components', 'lib', 'web/src'],
    pattern: String.raw`\b(?:format(?:Message|Chat|GroupChat|.*Time|.*Date)|isSame.*Group|get.*ReplyLabel|get.*CopyText|get.*Display)[A-Za-z0-9_]*`,
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
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
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

function resolveRepoName(root) {
  const packageJsonPath = path.join(root, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (typeof packageJson.name === 'string' && packageJson.name.trim()) {
        return packageJson.name.trim();
      }
    } catch {
      // Fall back to the checkout directory name for ad-hoc audit roots.
    }
  }
  return path.basename(root);
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

function scanSharedFunctionContracts(options = {}) {
  const root = options.root ?? process.cwd();
  const sampleLimit = Number.isInteger(options.sampleLimit) ? options.sampleLimit : 8;

  return {
    repo: resolveRepoName(root),
    excludedGlobs: EXCLUDED_GLOBS,
    categories: FUNCTION_AUDIT_CATEGORIES.map((category) => scanCategory(root, category, sampleLimit)),
  };
}

function formatFunctionInventoryMarkdown(inventory) {
  const lines = [
    `# Shared Function Contract Audit: ${inventory.repo}`,
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
  const inventory = scanSharedFunctionContracts();
  const asJson = process.argv.includes('--json');
  process.stdout.write(asJson ? `${JSON.stringify(inventory, null, 2)}\n` : formatFunctionInventoryMarkdown(inventory));
}

module.exports = {
  EXCLUDED_GLOBS,
  FUNCTION_AUDIT_CATEGORIES,
  formatFunctionInventoryMarkdown,
  scanSharedFunctionContracts,
};
