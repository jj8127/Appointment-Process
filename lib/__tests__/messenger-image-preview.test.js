/* global __dirname, jest, beforeEach, afterEach, test, expect */
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

// Execute the real component and hook with inert native views. No device,
// production session, image, storage object or network is used.
global.IS_REACT_ACT_ENVIRONMENT = true;
let session;
let focused;
let requests;
let root;
const loadUrl = jest.fn((id, token) => new Promise((resolve, reject) => requests.push({ id, token, resolve, reject })));
function loadModule(file, modules) {
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const result = {};
  new Function('require', 'exports', code)((name) => {
    if (name === 'react') return React;
    if (name === 'react/jsx-runtime') return require('react/jsx-runtime');
    if (!(name in modules)) throw new Error(`Unmocked module: ${name}`);
    return modules[name];
  }, result);
  return result;
}
const hooks = loadModule('hooks/use-messenger-image-preview.ts', {
  '@react-navigation/native': { useIsFocused: () => focused },
  '@/hooks/use-session': { useSession: () => session },
  '@/lib/messenger-attachment-api': { createMessengerAttachmentPreviewUrl: loadUrl },
});
const { MessengerAttachmentImage } = loadModule('components/MessengerAttachmentImage.tsx', {
  '@expo/vector-icons': { Feather: 'Icon' },
  'expo-image': { Image: 'Image' },
  'react-native': { ActivityIndicator: 'Spinner', Pressable: 'Pressable', Text: 'Text', View: 'View',
    StyleSheet: { create: (styles) => styles, absoluteFill: {} }, useWindowDimensions: () => ({ width: 390 }) },
  '@/components/ImagePreviewModal': { ImagePreviewModal: 'PreviewModal' },
  '@/hooks/use-messenger-image-preview': hooks,
});
const longPress = jest.fn();
const tree = (id = 'attachment-a') => React.createElement(MessengerAttachmentImage, { attachmentId: id, onLongPress: longPress });
const images = () => root.root.findAllByType('Image');
const press = () => root.root.findByType('Pressable');
async function resolve(index, url) {
  await act(async () => requests[index].resolve({ signedUrl: url, expiresAt: '2030-01-01T00:00:00Z' }));
}

beforeEach(() => { session = { appSessionToken: 'session-a' }; focused = true; requests = []; loadUrl.mockClear(); longPress.mockClear(); });
afterEach(async () => { if (root) await act(async () => root.unmount()); root = null; });

test('renders the actual photo inline, fits tall photos, and preserves long press', async () => {
  await act(async () => { root = create(tree()); });
  expect(root.root.findAllByType('Spinner')).toHaveLength(1);
  await resolve(0, 'https://example.invalid/photo-a');
  const image = images()[0];
  expect(image.props.source.uri).toBe('https://example.invalid/photo-a');
  expect(image.props.contentFit).toBe('contain');
  expect(image.props.cachePolicy).toBe('none');
  await act(async () => image.props.onLoad({ source: { width: 400, height: 1000 } }));
  expect(press().props.style[1]).toEqual({ width: 152, height: 380 });
  await act(async () => press().props.onLongPress());
  expect(longPress).toHaveBeenCalledTimes(1);
  expect(root.root.findAllByType('PreviewModal')).toHaveLength(0);
});

test('reauthorizes a full-screen open and uses the fresh URL', async () => {
  await act(async () => { root = create(tree()); });
  await resolve(0, 'https://example.invalid/old');
  await act(async () => press().props.onPress());
  expect(requests).toHaveLength(2);
  expect(root.root.findAllByType('PreviewModal')).toHaveLength(0);
  await resolve(1, 'https://example.invalid/new');
  expect(root.root.findByType('PreviewModal').props.images).toEqual([{ url: 'https://example.invalid/new' }]);
  await act(async () => root.root.findByType('PreviewModal').props.onClose());
  expect(root.root.findAllByType('PreviewModal')).toHaveLength(0);
});

test('allows retry after a signed image fails to load', async () => {
  await act(async () => { root = create(tree()); });
  await resolve(0, 'https://example.invalid/expired');
  await act(async () => images()[0].props.onError());
  expect(images()).toHaveLength(0);
  expect(press().props.accessibilityLabel).toBe('사진 다시 불러오기');
  await act(async () => press().props.onPress());
  await resolve(1, 'https://example.invalid/refreshed');
  expect(images()[0].props.source.uri).toBe('https://example.invalid/refreshed');
});

test('does not show the old attachment when an earlier request finishes late', async () => {
  await act(async () => { root = create(tree()); });
  await act(async () => root.update(tree('attachment-b')));
  await resolve(0, 'https://example.invalid/old-attachment');
  expect(images()).toHaveLength(0);
  await resolve(1, 'https://example.invalid/new-attachment');
  expect(images()[0].props.source.uri).toBe('https://example.invalid/new-attachment');
});

test('hides the old account image and ignores its pending full-screen request', async () => {
  await act(async () => { root = create(tree()); });
  await resolve(0, 'https://example.invalid/account-a');
  await act(async () => press().props.onPress());
  session = { appSessionToken: 'session-b' };
  await act(async () => root.update(tree()));
  expect(images()).toHaveLength(0);
  expect(requests[2].token).toBe('session-b');
  await resolve(1, 'https://example.invalid/late-account-a');
  expect(images()).toHaveLength(0);
  expect(root.root.findAllByType('PreviewModal')).toHaveLength(0);
  await resolve(2, 'https://example.invalid/account-b');
  expect(images()[0].props.source.uri).toBe('https://example.invalid/account-b');
});

test('clears the preview on logout without using a stored-session fallback', async () => {
  await act(async () => { root = create(tree()); });
  session = { appSessionToken: null };
  await act(async () => root.update(tree()));
  await resolve(0, 'https://example.invalid/late');
  expect(images()).toHaveLength(0);
  expect(requests).toHaveLength(1);
});

test('clears the previous room on blur and reloads on return', async () => {
  await act(async () => { root = create(tree()); });
  await resolve(0, 'https://example.invalid/first');
  focused = false;
  await act(async () => root.update(tree()));
  expect(images()).toHaveLength(0);
  focused = true;
  await act(async () => root.update(tree()));
  expect(requests).toHaveLength(2);
  await resolve(1, 'https://example.invalid/return');
  expect(images()[0].props.source.uri).toBe('https://example.invalid/return');
});

test('shows a retry state for denied or unavailable private URLs', async () => {
  await act(async () => { root = create(tree()); });
  await act(async () => requests[0].reject(new Error('denied')));
  expect(images()).toHaveLength(0);
  expect(press().props.accessibilityLabel).toBe('사진 다시 불러오기');
});

test('bounds a photo-heavy history and discards queued work after leaving', async () => {
  const history = () => React.createElement(React.Fragment, null,
    ...Array.from({ length: 7 }, (_, index) => React.createElement(MessengerAttachmentImage, {
      key: index, attachmentId: `fixture-${index}`, onLongPress: longPress,
    })));
  await act(async () => { root = create(history()); });
  expect(requests).toHaveLength(4);
  focused = false;
  await act(async () => root.update(history()));
  await act(async () => requests.forEach((request) => request.resolve({ signedUrl: 'https://example.invalid/discarded' })));
  expect(requests).toHaveLength(4);
  expect(images()).toHaveLength(0);
});
