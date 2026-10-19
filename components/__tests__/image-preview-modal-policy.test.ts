import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement, type ReactElement } from 'react';
import * as ts from 'typescript';

import {
  shouldEnableModalImageGestures,
  shouldVirtualizeModalImages,
} from '../image-preview-modal-policy';

type Instance = { props: Record<string, unknown>; findAllByType: (type: string) => Instance[]; children: (Instance | string)[] };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { create } = require('react-test-renderer') as {
  create: (element: ReactElement) => { root: Instance; update: (element: ReactElement) => void; unmount: () => void };
};
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function loadImagePreviewModal(platformOS: string) {
  const output = ts.transpileModule(readFileSync(join(__dirname, '../ImagePreviewModal.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exported: Record<string, unknown> = {};
  new Function('require', 'exports', output)((name: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === '@expo/vector-icons') return { Feather: 'Feather' };
    if (name === 'react-native') {
      return {
        ActivityIndicator: 'ActivityIndicator', FlatList: 'FlatList', Image: 'Image', Modal: 'Modal', Pressable: 'Pressable',
        ScrollView: 'ScrollView', Text: 'Text', View: 'View', Platform: { OS: platformOS },
        StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {}, absoluteFillObject: {} },
        useWindowDimensions: () => ({ width: 390, height: 844 }),
      };
    }
    if (name === 'react-native-gesture-handler') return { GestureHandlerRootView: 'GestureHandlerRootView' };
    if (name === 'react-native-reanimated') return { default: { View: 'AnimatedView' } };
    if (name === './image-preview-modal-policy') return { shouldEnableModalImageGestures, shouldVirtualizeModalImages };
    throw new Error(`Unexpected dependency: ${name}`);
  }, exported);
  return exported.ImagePreviewModal as (props: Record<string, unknown>) => ReactElement;
}

const textOf = (root: Instance) => root.findAllByType('Text').map((node) => node.children.join('')).join('\n');

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

describe('image preview modal load feedback', () => {
  const ImagePreviewModal = loadImagePreviewModal('android');
  const props = { visible: true, images: [{ url: 'https://example.test/a.jpg', title: 'a.jpg' }], onClose: jest.fn() };

  it('shows progress, then a failure message instead of a bare black overlay when the image cannot load', () => {
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(createElement(ImagePreviewModal, props)); });
    expect(renderer.root.findAllByType('ActivityIndicator')).toHaveLength(1);
    // Android only downsamples remote images with resizeMethod="resize"; full-size photos exhaust memory.
    expect(renderer.root.findAllByType('Image')[0].props.resizeMethod).toBe('resize');

    act(() => { (renderer.root.findAllByType('Image')[0].props.onError as () => void)(); });

    expect(renderer.root.findAllByType('ActivityIndicator')).toHaveLength(0);
    expect(textOf(renderer.root)).toContain('이미지를 불러올 수 없습니다.');
    act(() => renderer.unmount());
  });

  it('opens the Android pager on the tapped image and loads only it and its neighbours', () => {
    const images = Array.from({ length: 20 }, (_, index) => ({ url: `https://example.test/${index}.jpg`, title: `${index}.jpg` }));
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(createElement(ImagePreviewModal, { ...props, images, initialIndex: 9 })); });

    const pageWidth = 390 - 16 * 2;
    expect(renderer.root.findAllByType('ScrollView')[0].props.contentOffset).toEqual({ x: 9 * pageWidth, y: 0 });
    expect(textOf(renderer.root)).toContain('총 20장 중 10번째');
    expect(renderer.root.findAllByType('Image').map((image) => (image.props.source as { uri: string }).uri)).toEqual([
      'https://example.test/8.jpg',
      'https://example.test/9.jpg',
      'https://example.test/10.jpg',
    ]);
    act(() => renderer.unmount());
  });

  it('clears the status overlay once the image loads', () => {
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(createElement(ImagePreviewModal, props)); });

    act(() => { (renderer.root.findAllByType('Image')[0].props.onLoad as () => void)(); });

    expect(renderer.root.findAllByType('ActivityIndicator')).toHaveLength(0);
    expect(textOf(renderer.root)).not.toContain('이미지를 불러올 수 없습니다.');
    act(() => renderer.unmount());
  });
});
