export const HOME_GUIDE_ICON_BACKGROUND = '#f36f21';
export const HOME_GUIDE_ICON_FOREGROUND = '#ffffff';
export const HOME_GUIDE_ICON_BORDER = '#fb923c';
export const HOME_GUIDE_ICON_SHADOW = '#f36f21';

export type HomeGuideIconVisualContract = {
  backgroundColor: string;
  foregroundColor: string;
  borderColor: string;
  shadowColor: string;
};

export const getHomeGuideIconVisualContract = (): HomeGuideIconVisualContract => ({
  backgroundColor: HOME_GUIDE_ICON_BACKGROUND,
  foregroundColor: HOME_GUIDE_ICON_FOREGROUND,
  borderColor: HOME_GUIDE_ICON_BORDER,
  shadowColor: HOME_GUIDE_ICON_SHADOW,
});
