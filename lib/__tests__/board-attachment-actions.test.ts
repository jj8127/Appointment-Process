import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createElement } from 'react';
import { JsxEmit, ModuleKind, transpileModule } from 'typescript';

import { openBoardAttachment } from '../board-attachment-actions';
import { createBoardComposerOperationGate } from '../board-composer-operation';

const root = process.cwd();

function readRepoFile(path: string) {
  return readFileSync(join(root, path), 'utf8');
}

describe('board attachment actions', () => {
  it('opens a signed attachment URL through the supplied opener', async () => {
    const openExternalUrl = jest.fn().mockResolvedValue('https://example.test/file.pdf');
    const alert = jest.fn();

    await expect(openBoardAttachment({
      signedUrl: 'https://example.test/file.pdf',
      openExternalUrl,
      alert,
    })).resolves.toBe(true);

    expect(openExternalUrl).toHaveBeenCalledWith('https://example.test/file.pdf');
    expect(alert).not.toHaveBeenCalled();
  });

  it('shows shared failure feedback when attachment opening fails', async () => {
    const error = new Error('open failed');
    const openExternalUrl = jest.fn().mockRejectedValue(error);
    const alert = jest.fn();
    const logError = jest.fn();

    await expect(openBoardAttachment({
      signedUrl: 'https://example.test/file.pdf',
      openExternalUrl,
      alert,
      logError,
    })).resolves.toBe(false);

    expect(alert).toHaveBeenCalledWith('오류', '첨부파일을 열 수 없습니다.');
    expect(logError).toHaveBeenCalledWith('attachment-open', error);
  });

  it('keeps mobile and admin board attachment opening on the shared helper', () => {
    for (const source of [
      readRepoFile('app/board.tsx'),
      readRepoFile('app/admin-board-manage.tsx'),
    ]) {
      expect(source).toContain("from '@/lib/board-attachment-actions'");
      expect(source).toContain('openBoardAttachment');
      expect(source).not.toContain('openExternalUrl(item.signedUrl).catch');
    }
  });
});

type Action = () => void | Promise<void>;
type NativeNode = {
  props: { name?: string; onPress?: Action };
  findAllByType(type: string): NativeNode[];
};
type NativeRenderer = { root: NativeNode; unmount(): void };
type TestAlert = { title: string; buttons: { text: string; onPress?: Action }[] };

const runtimeRequire = createRequire(join(root, 'package.json'));
const { act, create } = runtimeRequire('react-test-renderer') as {
  act(callback: () => void | Promise<void>): Promise<void>;
  create(element: ReturnType<typeof createElement>): NativeRenderer;
};

const compiledComposer = transpileModule(readRepoFile('app/admin-board.tsx'), {
  compilerOptions: { module: ModuleKind.CommonJS, jsx: JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

function deferredOperation() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function renderComposer() {
  const alerts: TestAlert[] = [];
  const actor = { role: 'admin', residentId: 'test-actor', displayName: 'Test Admin' };
  const api = {
    buildBoardActor: () => actor,
    createBoardPost: jest.fn().mockResolvedValue({ id: 'post' }),
    updateBoardPost: jest.fn().mockResolvedValue({}),
    deleteBoardAttachments: jest.fn().mockResolvedValue(undefined),
    signBoardAttachments: jest.fn().mockResolvedValue([
      { signedUrl: 'https://example.test/upload', storagePath: 'test/file.pdf' },
    ]),
    finalizeBoardAttachments: jest.fn().mockResolvedValue(undefined),
    formatFileSize: () => '1 KB',
    logBoardError: jest.fn(),
  };
  const picker = jest.fn().mockResolvedValue({ canceled: true });
  const router = { back: jest.fn(), replace: jest.fn() };
  const mocks: Record<string, unknown> = {
    '@expo/vector-icons': { Feather: 'Feather' },
    '@tanstack/react-query': {
      useQueryClient: () => ({ invalidateQueries: jest.fn() }),
      useQuery: ({ queryKey }: { queryKey: string[] }) => ({
        data: queryKey[0] === 'board-categories'
          ? [{ id: 'category', name: 'Test Category' }]
          : {
            post: { title: 'Test Post', content: 'Test Content', categoryId: 'category', isMine: true },
            attachments: ['first', 'second'].map((id) => ({
              id, fileName: `${id}.pdf`, fileSize: 10, fileType: 'file', signedUrl: '',
            })),
          },
      }),
    },
    'expo-document-picker': { getDocumentAsync: picker },
    'expo-image-picker': { launchImageLibraryAsync: picker },
    'expo-router': { useRouter: () => router, useLocalSearchParams: () => ({ postId: 'post' }) },
    'react-native': {
      Alert: { alert: (title: string, _message: string, buttons: TestAlert['buttons'] = []) => {
        alerts.push({ title, buttons });
      } },
      Platform: { OS: 'web' },
      StyleSheet: { create: (styles: unknown) => styles },
      ...Object.fromEntries(['Image', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map((name) => [name, name])),
    },
    'react-native-draggable-flatlist': 'DraggableFlatList',
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/components/Button': { Button: 'Button' },
    '@/components/FormInput': { FormInput: 'FormInput' },
    '@/components/KeyboardAwareWrapper': { KeyboardAwareWrapper: 'KeyboardAwareWrapper' },
    '@/components/RefreshButton': { RefreshButton: 'RefreshButton' },
    '@/hooks/use-keyboard-padding': { useKeyboardPadding: () => 0 },
    '@/hooks/use-session': { useSession: () => ({ ...actor, readOnly: false }) },
    '@/lib/board-api': api,
    '@/lib/board-composer-operation': { createBoardComposerOperationGate },
    '@/lib/open-external-url': { openExternalUrl: jest.fn() },
  };
  const composerModule = { exports: {} as { default: () => ReturnType<typeof createElement> } };
  const load = (name: string) => name in mocks ? mocks[name] : runtimeRequire(name);
  // Execute the screen's real handlers with React hooks; only native/network boundaries are mocked.
  new Function('require', 'module', 'exports', compiledComposer)(load, composerModule, composerModule.exports);
  let renderer!: NativeRenderer;
  await act(() => { renderer = create(createElement(composerModule.exports.default)); });

  return {
    api, picker, alerts, renderer,
    submit: renderer.root.findAllByType('Button')[0].props.onPress!,
    pressIcon: (name: string) => renderer.root.findAllByType('Pressable')
      .find((node) => node.findAllByType('Feather').some((icon) => icon.props.name === name))!.props.onPress!(),
    confirmDelete: () => alerts.find((alert) => alert.title === '첨부 삭제')!
      .buttons.find((button) => button.text === '삭제')!.onPress!(),
  };
}

describe('board composer overlapping user actions', () => {
  const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previousActEnvironment = actGlobal.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => { actGlobal.IS_REACT_ACT_ENVIRONMENT = true; });
  afterAll(() => { actGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment; });
  beforeEach(() => {
    const consoleError = console.error;
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      if (!String(args[0]).startsWith('react-test-renderer is deprecated.')) consoleError(...args);
    });
  });
  afterEach(() => { jest.restoreAllMocks(); });

  it('saves the post-deletion attachment order even through a handler from the previous render', async () => {
    const composer = await renderComposer();
    const deletion = deferredOperation();
    composer.api.deleteBoardAttachments.mockReturnValueOnce(deletion.promise);
    composer.pressIcon('trash-2');
    await act(async () => {
      const deleting = composer.confirmDelete();
      await composer.submit();
      expect(composer.api.updateBoardPost).not.toHaveBeenCalled();
      deletion.resolve();
      await deleting;
      await composer.submit();
    });
    expect(composer.api.updateBoardPost).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      attachmentOrder: ['second'],
    }));
    await act(() => composer.renderer.unmount());
  });

  it('blocks duplicate saves and a delayed delete confirmation during and after a successful save', async () => {
    const composer = await renderComposer();
    const write = deferredOperation();
    composer.api.updateBoardPost.mockReturnValueOnce(write.promise);
    composer.pressIcon('trash-2');
    await act(async () => {
      const saving = composer.submit();
      await composer.submit();
      await composer.confirmDelete();
      expect(composer.api.updateBoardPost).toHaveBeenCalledTimes(1);
      expect(composer.api.deleteBoardAttachments).not.toHaveBeenCalled();
      write.resolve();
      await saving;
      await composer.submit();
      await composer.confirmDelete();
    });
    expect(composer.api.updateBoardPost).toHaveBeenCalledTimes(1);
    expect(composer.api.deleteBoardAttachments).not.toHaveBeenCalled();
    await act(() => composer.renderer.unmount());
  });

  it('uses newly picked files when saving before the selection render commits', async () => {
    const composer = await renderComposer();
    composer.picker.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///test.pdf', name: 'test.pdf', mimeType: 'application/pdf', size: 10 }],
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob() } as Response);
    await act(async () => {
      const picking = composer.pressIcon('paperclip');
      await composer.submit();
      expect(composer.api.updateBoardPost).not.toHaveBeenCalled();
      await picking;
      await composer.submit();
    });
    expect(composer.api.signBoardAttachments).toHaveBeenCalledWith(expect.anything(), 'post', [
      expect.objectContaining({ fileName: 'test.pdf' }),
    ]);
    expect(composer.api.finalizeBoardAttachments).toHaveBeenCalledWith(expect.anything(), 'post', [
      expect.objectContaining({ fileName: 'test.pdf', sortOrder: 2 }),
    ]);
    await act(() => composer.renderer.unmount());
  });
});
