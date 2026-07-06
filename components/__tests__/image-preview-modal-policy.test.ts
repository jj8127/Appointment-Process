import {
  shouldEnableModalImageGestures,
  shouldVirtualizeModalImages,
} from '../image-preview-modal-policy';

describe('image preview modal platform policy', () => {
  it('keeps the gesture/reanimated image path out of Android modals', () => {
    expect(shouldEnableModalImageGestures('android')).toBe(false);
  });

  it('keeps pinch zoom enabled on non-Android platforms', () => {
    expect(shouldEnableModalImageGestures('ios')).toBe(true);
    expect(shouldEnableModalImageGestures('web')).toBe(true);
  });

  it('renders Android modal pages without FlatList virtualization', () => {
    expect(shouldVirtualizeModalImages('android')).toBe(false);
    expect(shouldVirtualizeModalImages('ios')).toBe(true);
  });
});
