/* global __dirname */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY_PATH = path.join(__dirname, 'mobile-keyboard-surfaces.json');

function walkTsx(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkTsx(absolute);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [absolute] : [];
  });
}

function relativeFile(absolute) {
  return path.relative(ROOT, absolute).replaceAll(path.sep, '/');
}

function discoverKeyboardSurfaceFiles() {
  const files = [
    ...walkTsx(path.join(ROOT, 'app')),
    ...walkTsx(path.join(ROOT, 'components')),
  ];
  const sources = new Map(files.map((file) => [file, fs.readFileSync(file, 'utf8')]));
  const sharedInputNames = files
    .filter((file) => relativeFile(file).startsWith('components/'))
    .filter((file) => /<TextInput\b/.test(sources.get(file)))
    .map((file) => path.basename(file, '.tsx'));
  const sharedUsage = sharedInputNames.length > 0
    ? new RegExp(`<(?:${sharedInputNames.join('|')})\\b`)
    : null;

  return files
    .filter((file) => {
      const source = sources.get(file);
      return /<TextInput\b/.test(source) || (sharedUsage ? sharedUsage.test(source) : false);
    })
    .map(relativeFile)
    .sort();
}

function runAudit() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const registered = registry.surfaces.map((surface) => surface.file).sort();
  const discovered = discoverKeyboardSurfaceFiles();
  const registeredSet = new Set(registered);
  const discoveredSet = new Set(discovered);
  const errors = [];

  for (const file of discovered) {
    if (!registeredSet.has(file)) errors.push(`unregistered keyboard surface: ${file}`);
  }
  for (const file of registered) {
    if (!discoveredSet.has(file)) errors.push(`stale keyboard surface registry entry: ${file}`);
  }

  for (const surface of registry.surfaces) {
    const absolute = path.join(ROOT, surface.file);
    if (!fs.existsSync(absolute)) continue;
    const source = fs.readFileSync(absolute, 'utf8');
    for (const token of surface.requiredTokens ?? []) {
      if (!source.includes(token)) {
        errors.push(`${surface.file} (${surface.kind}) missing required token: ${token}`);
      }
    }
    for (const pattern of surface.requiredPatterns ?? []) {
      if (!new RegExp(pattern, 'm').test(source)) {
        errors.push(`${surface.file} (${surface.kind}) missing required structure: ${pattern}`);
      }
    }
    for (const pattern of surface.forbiddenPatterns ?? []) {
      if (new RegExp(pattern, 'm').test(source)) {
        errors.push(`${surface.file} (${surface.kind}) contains forbidden structure: ${pattern}`);
      }
    }
  }

  const countsByKind = registry.surfaces.reduce((counts, surface) => {
    counts[surface.kind] = (counts[surface.kind] ?? 0) + 1;
    return counts;
  }, {});

  return {
    version: registry.version,
    discovered,
    registered,
    countsByKind,
    errors,
  };
}

if (require.main === module) {
  const result = runAudit();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`mobile keyboard surfaces: ${result.discovered.length}\n`);
    process.stdout.write(`registered surfaces: ${result.registered.length}\n`);
    process.stdout.write(`contract errors: ${result.errors.length}\n`);
    for (const error of result.errors) process.stdout.write(`- ${error}\n`);
  }
  process.exitCode = result.errors.length === 0 ? 0 : 1;
}

module.exports = { discoverKeyboardSurfaceFiles, runAudit };
