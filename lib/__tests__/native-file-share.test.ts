const mockFileSystem = {
  cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: jest.fn(async () => undefined),
  downloadAsync: jest.fn(async (_url: string, target: string) => ({ uri: target })),
};
let mockNativeSharing: object | null = {};

jest.mock('expo-file-system/legacy', () => mockFileSystem);
jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: () => mockNativeSharing }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: async () => undefined }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

// eslint-disable-next-line import/first
import { loadFileSharing, shareRemoteFile } from '@/lib/native-file-actions';

describe('native file sharing', () => {
  beforeEach(() => jest.clearAllMocks());

  it('downloads under the original file name and opens the share sheet with its type', async () => {
    const sharing = { isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) };
    await shareRemoteFile({ url: 'https://files.example/a', fileName: '11월/시책표.pdf', mimeType: 'application/pdf', sharing });

    const target = mockFileSystem.downloadAsync.mock.calls[0][1];
    expect(target).toMatch(/^file:\/\/\/cache\/share-\d+\/11월_시책표\.pdf$/);
    expect(mockFileSystem.makeDirectoryAsync).toHaveBeenCalledWith(expect.stringMatching(/share-\d+\/$/), { intermediates: true });
    expect(sharing.shareAsync).toHaveBeenCalledWith(target, { mimeType: 'application/pdf', dialogTitle: '11월/시책표.pdf' });
  });

  it('refuses before downloading when sharing is missing or unavailable', async () => {
    await expect(shareRemoteFile({ url: 'https://files.example/a', fileName: 'a.pdf', sharing: null })).rejects.toThrow('파일 공유');
    const unavailable = { isAvailableAsync: async () => false, shareAsync: jest.fn() };
    await expect(shareRemoteFile({ url: 'https://files.example/a', fileName: 'a.pdf', sharing: unavailable })).rejects.toThrow('파일 공유');
    expect(mockFileSystem.downloadAsync).not.toHaveBeenCalled();
    expect(unavailable.shareAsync).not.toHaveBeenCalled();
  });

  it('reports no sharing on app binaries built before the native module existed', () => {
    mockNativeSharing = null;
    expect(loadFileSharing()).toBeNull();
    mockNativeSharing = {};
    expect(loadFileSharing()).not.toBeNull();
  });
});
