import { getReferralGraphLabelSize } from './referral-graph-readable';

export type ReferralGraphNodeAmounts = {
  nodeId: string;
  directText: string;
  totalText: string;
  directNegative: boolean;
  totalNegative: boolean;
};

/** Bounds and typography for one node's name and two amount rows. */
export function getReferralGraphNodeAmountMetrics(name: string, amounts: ReferralGraphNodeAmounts, fontScale = 1) {
  const textScale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const nameSize = getReferralGraphLabelSize(name, textScale);
  const textWidth = (text: string) => Array.from(text).reduce((width, char) => width + (char.charCodeAt(0) > 255 ? 10 : 7), 0) * textScale;
  const lineHeight = 14 * textScale;
  const nameGap = 3 * textScale;
  return {
    width: Math.ceil(Math.max(nameSize.width, textWidth(amounts.directText), textWidth(amounts.totalText))) + 12,
    height: nameSize.height + nameGap + lineHeight * 2 + 8,
    nameFontSize: 11 * textScale,
    fontSize: 10 * textScale,
    lineHeight,
    nameGap,
  };
}
