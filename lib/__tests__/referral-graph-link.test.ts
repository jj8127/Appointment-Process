import { buildReferralGraphWebUrl } from '../referral-graph-link';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('referral graph web link helpers', () => {
  it('returns null when the admin web url is missing', () => {
    expect(buildReferralGraphWebUrl('')).toBeNull();
    expect(buildReferralGraphWebUrl('   ')).toBeNull();
  });

  it('builds the graph view url without duplicating slashes', () => {
    expect(buildReferralGraphWebUrl('https://admin.example.com/')).toBe(
      'https://admin.example.com/dashboard/referrals/graph',
    );
  });

  it('keeps local admin web urls usable for development', () => {
    expect(buildReferralGraphWebUrl('http://localhost:3000')).toBe(
      'http://localhost:3000/dashboard/referrals/graph',
    );
  });

  it('opens the native referral graph from the referral page', () => {
    const referralPageSource = readFileSync(join(process.cwd(), 'app/referral.tsx'), 'utf8');

    expect(referralPageSource).toContain("router.push('/referral-graph')");
    expect(referralPageSource).toContain('추천 관계 그래프로 보기');
    expect(referralPageSource).toContain('앱 안에서 하위 연결을 확대하고 살펴봅니다');
    expect(referralPageSource).not.toContain('buildReferralGraphWebUrl');
    expect(referralPageSource).not.toContain('Linking.openURL');
    expect(referralPageSource).not.toContain('EXPO_PUBLIC_ADMIN_WEB_URL');
  });

  it('renders the native graph through a density-bounded SVG surface', () => {
    const canvasSource = readFileSync(
      join(process.cwd(), 'components/referral-graph/ReferralGraphCanvas.tsx'),
      'utf8',
    );

    expect(canvasSource).toContain(
      'getReferralGraphRenderSurfaceSize(PixelRatio.get())',
    );
    expect(canvasSource).toContain('width={GRAPH_RENDER_SURFACE_SIZE}');
    expect(canvasSource).toContain('height={GRAPH_RENDER_SURFACE_SIZE}');
    expect(canvasSource).toContain('getReferralGraphNodeScreenRadius(');
    expect(canvasSource).toContain('projectReferralGraphPoint(');
    expect(canvasSource).toContain('useAnimatedProps(');
    expect(canvasSource).toContain('buildReadableReferralGraphLayout(');
    expect(canvasSource).toContain('buildReferralGraphLabels(');
    expect(canvasSource).toContain('clampReadableReferralGraphScale(');
    expect(canvasSource).toContain('.onFinalize(');
    expect(canvasSource).not.toContain('opacity: Math.abs(scale.value - displayScale)');
    expect(canvasSource).not.toContain('panX.value - renderCamera.panX');
    expect(canvasSource).toContain('if (!pinchActive.value) return;');
    expect(canvasSource).not.toContain('GRAPH_RENDER_COORDINATE_SCALE');
    expect(canvasSource).toContain('const ReferralGraphNodeMarker = memo');
    expect(canvasSource).toContain('const ReferralGraphNodeLabel = memo');
    expect(canvasSource).toContain('style={styles.nodeLabelLayer}');
    expect(canvasSource.indexOf('<ReferralGraphNodeMarker')).toBeLessThan(
      canvasSource.indexOf('<ReferralGraphNodeLabel'),
    );
    expect(canvasSource).toContain("textShadowColor: '#f8fafc'");
    expect(canvasSource).not.toContain('SvgText');
    expect(canvasSource).not.toContain('<Circle');
    expect(canvasSource).not.toContain('const minimumScreenRadius');
    expect(canvasSource).not.toContain('Math.min(34, 11 /');
    expect(canvasSource).not.toContain('width={REFERRAL_GRAPH_SURFACE_SIZE}');
    expect(canvasSource).not.toContain('height={REFERRAL_GRAPH_SURFACE_SIZE}');
  });
});
