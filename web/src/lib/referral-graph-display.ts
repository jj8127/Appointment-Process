export type ReferralGraphLabelPresentationInput = {
  globalScale: number;
  isSelected: boolean;
  isSearchMatch: boolean;
  isHighlighted: boolean;
  linkCount: number;
};

export type ReferralGraphLabelPresentation = {
  alpha: number;
  visible: boolean;
  showCode: boolean;
  fontWeight: 500 | 600 | 700;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getReferralGraphLabelPresentation({
  globalScale,
  isSelected,
  isSearchMatch,
  isHighlighted,
  linkCount,
}: ReferralGraphLabelPresentationInput): ReferralGraphLabelPresentation {
  if (isSelected || isSearchMatch) {
    return {
      alpha: 1,
      visible: true,
      showCode: true,
      fontWeight: 700,
    };
  }

  if (isHighlighted) {
    return {
      alpha: clamp(0.55 + ((globalScale - 0.8) * 0.35), 0.5, 0.92),
      visible: true,
      showCode: false,
      fontWeight: 700,
    };
  }

  const fullLabelAlpha = clamp((globalScale - 1.55) / 0.7, 0, 1);
  const hubLabelAlpha = linkCount >= 5 ? clamp((globalScale - 0.72) / 0.68, 0.54, 0.84) : 0;
  const overviewLabelAlpha = clamp(0.38 + ((globalScale - 0.8) * 0.1), 0.34, 0.48);
  const alpha = Math.max(overviewLabelAlpha, fullLabelAlpha, hubLabelAlpha);

  return {
    alpha,
    visible: true,
    showCode: false,
    fontWeight: linkCount >= 5 ? 600 : 500,
  };
}
