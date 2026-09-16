import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { projectReferralGraphPoint } from '../referral-graph-readable';
import { REFERRAL_GRAPH_SURFACE_CENTER } from '../referral-graph-native';

const canvasSource = readFileSync(join(process.cwd(), 'components/referral-graph/ReferralGraphCanvas.tsx'), 'utf8');
const parsed = ts.createSourceFile('ReferralGraphCanvas.tsx', canvasSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findEdgeUpdater(node: ts.Node): ts.ArrowFunction | undefined {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'edgeProps'
    && node.initializer && ts.isCallExpression(node.initializer)) {
    const updater = node.initializer.arguments[0];
    if (ts.isArrowFunction(updater)) return updater;
  }
  return ts.forEachChild(node, findEdgeUpdater);
}

const updater = findEdgeUpdater(parsed);
if (!updater) throw new Error('The canvas animated edge updater is missing.');
const updaterScript = ts.transpileModule(`const update = ${updater.getText(parsed)}; update();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

type EdgeProps = { transform?: number[]; matrix?: number[]; strokeWidth: number };
type Camera = { scale: number; panX: number; panY: number; width: number; height: number };

function edgeProps(platform: 'web' | 'android' | 'ios', camera: Camera): EdgeProps {
  return runInNewContext(updaterScript, {
    IS_WEB: platform === 'web',
    scale: { value: camera.scale }, panX: { value: camera.panX }, panY: { value: camera.panY },
    canvasSize: { width: camera.width, height: camera.height },
  });
}

describe('referral graph animated SVG edge projection', () => {
  const cameras = [
    { scale: 0.7, panX: 0, panY: 0, width: 390, height: 420 },
    { scale: 1.8, panX: -37, panY: 62, width: 360, height: 640 },
  ];

  it('selects the web SVG transform property using the runtime platform', () => {
    expect(canvasSource).toContain("const IS_WEB = Platform.OS === 'web'");
    const props = edgeProps('web', cameras[0]);
    expect(props.transform).toEqual([0.7, 0, 0, 0.7, 195, 210]);
    expect(props).not.toHaveProperty('matrix');
  });

  it.each(['android', 'ios'] as const)('preserves the native matrix prop on %s', (platform) => {
    const props = edgeProps(platform, cameras[0]);
    expect(props.matrix).toEqual([0.7, 0, 0, 0.7, 195, 210]);
    expect(props).not.toHaveProperty('transform');
  });

  it.each(cameras)('keeps edges aligned with node projection at scale $scale after pan', (camera) => {
    for (const platform of ['web', 'android', 'ios'] as const) {
      const props = edgeProps(platform, camera);
      const matrix = props.transform ?? props.matrix!;
      for (const point of [{ x: 900, y: 900 }, { x: 1010, y: 660 }, { x: 810, y: 1075 }]) {
        const screen = projectReferralGraphPoint(point, camera.scale, camera.panX, camera.panY, camera.width, camera.height);
        // Render-set SVG path coordinates are relative to the logical graph center.
        const pathX = point.x - REFERRAL_GRAPH_SURFACE_CENTER;
        const pathY = point.y - REFERRAL_GRAPH_SURFACE_CENTER;
        expect(matrix[0] * pathX + matrix[2] * pathY + matrix[4]).toBeCloseTo(screen.x);
        expect(matrix[1] * pathX + matrix[3] * pathY + matrix[5]).toBeCloseTo(screen.y);
      }
      expect(props.strokeWidth * camera.scale).toBeCloseTo(1.4);
    }
  });
});
