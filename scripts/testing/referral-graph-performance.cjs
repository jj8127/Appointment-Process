#!/usr/bin/env node
// Local synthetic-only preparation and diagnostics. No services, production data or device access.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const variant = option('--variant', 'current');
if (!['baseline', 'current'].includes(variant)) throw new Error('Expected baseline or current variant');
const baseline = path.join(root, '.codex-tmp/referral-performance-baseline');
const sourcePaths = [
  'components/referral-graph/ReferralGraphCanvas.tsx',
  'lib/referral-graph-readable.ts',
  'lib/referral-graph-native.ts',
];
if (variant === 'current') sourcePaths.push('lib/referral-graph-render-model.ts', 'lib/referral-graph-viewport.ts');
const sources = sourcePaths.map((source) => {
  const filename = variant === 'baseline' ? path.join(baseline, path.basename(source)) : path.join(root, source);
  return { source, filename, sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex') };
});

if (process.argv.includes('--prepare')) {
  const result = spawnSync(process.execPath, ['scripts/testing/referral-graph-emulator.cjs'], { cwd: root, stdio: 'pipe' });
  if (result.status !== 0) throw new Error('Offline QA project preparation failed');
  const project = path.join(root, '.codex-tmp/referral-emulator');
  const configPath = path.join(project, 'metro.config.js');
  const config = fs.readFileSync(configPath, 'utf8');
  const mappings = variant === 'baseline' ? Object.fromEntries(sources.map(({ source, filename }) => [path.join(root, source), filename])) : {};
  fs.writeFileSync(configPath, config + `
// Task-only renderer selector. Both variants use the identical fictional QA entry.
const originalResolver = config.resolver.resolveRequest;
const baselineSources = ${JSON.stringify(mappings)};
config.resolver.resolveRequest = (context, name, platform) => {
  const result = originalResolver(context, name, platform);
  if (result && result.type === 'sourceFile' && baselineSources[result.filePath]) {
    return { ...result, filePath: baselineSources[result.filePath] };
  }
  return result;
};
`, 'utf8');
  const manifest = { variant, fixture: 'fictional-balanced-300', nodes: 300, edges: 299,
    sources: sources.map(({ source, sha256 }) => ({ source, sha256 })) };
  fs.writeFileSync(path.join(project, 'performance-source.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ prepared: variant, fixture: manifest.fixture, sourceFiles: sources.length }));
} else if (process.argv.includes('--report')) {
  const ts = require('typescript');
  require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, filename);
  const oldReadable = require(path.join(baseline, 'referral-graph-readable.ts'));
  const readable = require(path.join(root, 'lib/referral-graph-readable.ts'));
  const native = require(path.join(root, 'lib/referral-graph-native.ts'));
  const render = require(path.join(root, 'lib/referral-graph-render-model.ts'));
  const { syntheticReferralGraph } = require('./referral-graph-emulator/synthetic-graph.ts');
  const width = 360, height = 520;
  const timePass = (callback) => {
    for (let index = 0; index < 10; index++) callback();
    const samples = Array.from({ length: 50 }, () => {
      const started = performance.now(); callback(); return performance.now() - started;
    }).sort((a, b) => a - b);
    return { samples: samples.length, p50Ms: +samples[24].toFixed(3), p95Ms: +samples[47].toFixed(3) };
  };
  const metrics = [];
  for (const count of [50, 100, 200, 300]) {
    const { nodes, edges } = syntheticReferralGraph(count);
    const positions = readable.buildReadableReferralGraphLayout(nodes, edges);
    const oldPositions = oldReadable.buildReadableReferralGraphLayout(nodes, edges);
    if (JSON.stringify([...positions]) !== JSON.stringify([...oldPositions])) throw new Error('Layout changed; independent count comparison needs identical positions');
    const fit = readable.getReadableReferralGraphViewport({ positions, width, height });
    const center = positions.get(nodes[0].id);
    const centerCamera = (scale) => ({ scale, width, height,
      panX: -(center.x - native.REFERRAL_GRAPH_SURFACE_CENTER) * scale,
      panY: -(center.y - native.REFERRAL_GRAPH_SURFACE_CENTER) * scale });
    const cameras = [
      { scenario: 'whole-graph-fit', camera: { ...fit, width, height } },
      { scenario: 'viewer-neighborhood-31-percent', camera: centerCamera(.31) },
      { scenario: 'viewer-neighborhood-100-percent', camera: centerCamera(1) },
    ];
    for (const { scenario, camera } of cameras) {
      const labelOptions = { nodes, positions, scale: camera.scale, fontScale: 1 };
      const previousLabels = oldReadable.buildReferralGraphLabels(labelOptions);
      const currentLabels = readable.buildReferralGraphLabels(labelOptions);
      if (JSON.stringify([...previousLabels]) !== JSON.stringify([...currentLabels])) throw new Error('Label placement differs from preserved baseline');
      const renderOptions = { nodes, edges, positions, camera, primitivePadding: render.getReferralGraphPrimitivePadding(nodes, 1) };
      const current = render.buildReferralGraphRenderSet(renderOptions);
      const currentLabelsMounted = current.positionedNodes.filter(({ node }) => currentLabels.has(node.id)).length;
      metrics.push({ fixture: `fictional-balanced-${count}`, scenario, scale: +camera.scale.toFixed(6),
        baseline: { mountedNodes: nodes.length, mountedLabels: previousLabels.size, renderedEdges: edges.length, nativeEdgeElements: edges.length,
          labelPass: timePass(() => oldReadable.buildReferralGraphLabels(labelOptions)) },
        current: { mountedNodes: current.positionedNodes.length, mountedLabels: currentLabelsMounted,
          renderedEdges: current.edgeCount, nativeEdgeElements: 1,
          labelPass: timePass(() => readable.buildReferralGraphLabels(labelOptions)),
          renderSetPass: timePass(() => render.buildReferralGraphRenderSet(renderOptions)) },
        labelsMatchBaseline: true,
      });
    }
  }
  const report = { fixtureSource: 'entirely fictional balanced tree', viewportDp: { width, height },
    limits: ['Counts execute production render-set/label functions; they do not sample the mounted native tree.',
      'CPU timings are local Node.js samples, not mobile frame time or battery use.',
      'Screen reader and fit-animation modes intentionally render all nodes.'],
    sources: sources.map(({ source, sha256 }) => ({ source, sha256 })), metrics };
  const output = option('--output', '.codex-tmp/referral-emulator-evidence/performance-counts.json');
  const filename = path.resolve(root, output);
  const allowed = path.join(root, '.codex-tmp') + path.sep;
  if (!filename.startsWith(allowed)) throw new Error('Performance evidence must remain inside .codex-tmp');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(JSON.stringify({ variant, sources: sources.map(({ source, sha256 }) => ({ source, sha256 })),
    note: 'Use --prepare for an isolated offline emulator bundle.' }, null, 2));
}
