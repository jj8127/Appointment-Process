export type ReferralGraphResponsiveMode = 'mobile' | 'tablet' | 'desktop';

export type ReferralGraphLegendPlacement = 'floating' | 'bottom-strip';
export type ReferralGraphPhysicsPanelPlacement = 'floating' | 'bottom-sheet';

export type ReferralGraphResponsiveLayout = {
  mode: ReferralGraphResponsiveMode;
  shellHeight: string;
  canvasMinHeight: number;
  headerStacked: boolean;
  showLongDescription: boolean;
  controlsScrollable: boolean;
  statsScrollable: boolean;
  legendPlacement: ReferralGraphLegendPlacement;
  physicsPanelPlacement: ReferralGraphPhysicsPanelPlacement;
  physicsPanelWidth: number;
};

export function getReferralGraphResponsiveLayout(viewportWidth: number | null | undefined): ReferralGraphResponsiveLayout {
  const width = Number.isFinite(viewportWidth) && viewportWidth != null && viewportWidth > 0
    ? viewportWidth
    : 1280;

  if (width < 640) {
    return {
      mode: 'mobile',
      shellHeight: 'calc(100dvh - 64px - 32px)',
      canvasMinHeight: 360,
      headerStacked: true,
      showLongDescription: false,
      controlsScrollable: true,
      statsScrollable: true,
      legendPlacement: 'bottom-strip',
      physicsPanelPlacement: 'bottom-sheet',
      physicsPanelWidth: Math.max(280, Math.min(360, width - 24)),
    };
  }

  if (width < 960) {
    return {
      mode: 'tablet',
      shellHeight: 'calc(100dvh - 64px - 32px)',
      canvasMinHeight: 460,
      headerStacked: true,
      showLongDescription: true,
      controlsScrollable: true,
      statsScrollable: true,
      legendPlacement: 'floating',
      physicsPanelPlacement: 'floating',
      physicsPanelWidth: 320,
    };
  }

  return {
    mode: 'desktop',
    shellHeight: 'calc(100dvh - 64px - 32px)',
    canvasMinHeight: 560,
    headerStacked: false,
    showLongDescription: true,
    controlsScrollable: false,
    statsScrollable: false,
    legendPlacement: 'floating',
    physicsPanelPlacement: 'floating',
    physicsPanelWidth: 340,
  };
}
