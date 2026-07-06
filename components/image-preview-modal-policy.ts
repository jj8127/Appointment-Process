export function shouldEnableModalImageGestures(platformOS: string): boolean {
  return platformOS !== 'android';
}

export function shouldVirtualizeModalImages(platformOS: string): boolean {
  return platformOS !== 'android';
}
