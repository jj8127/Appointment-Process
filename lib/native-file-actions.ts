import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

type DownloadRemoteFileToUserStorageOptions = {
  url: string;
  fileName: string;
  mimeType?: string;
  tempPrefix?: string;
  fallbackFileName?: string;
};

export type DownloadRemoteFileToUserStorageResult = {
  fileName: string;
  destinationLabel: string;
};

export function sanitizeNativeFileName(
  fileName: string | null | undefined,
  fallbackFileName = `garamin-file-${Date.now()}`,
): string {
  const cleaned = String(fileName ?? '').replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned || fallbackFileName;
}

export function appendTimestampToFileName(fileName: string, timestamp = Date.now()): string {
  const dotIndex = fileName.lastIndexOf('.');
  const base = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const extension = dotIndex > 0 ? fileName.slice(dotIndex) : '';
  return `${base}-${timestamp}${extension}`;
}

export async function downloadRemoteFileToUserStorage({
  url,
  fileName,
  mimeType = 'application/octet-stream',
  tempPrefix = 'download',
  fallbackFileName,
}: DownloadRemoteFileToUserStorageOptions): Promise<DownloadRemoteFileToUserStorageResult> {
  const safeFileName = sanitizeNativeFileName(fileName, fallbackFileName);
  const tempBaseDir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;

  if (!tempBaseDir) {
    throw new Error('다운로드 임시 저장 경로를 찾을 수 없습니다.');
  }

  const downloaded = await FileSystem.downloadAsync(url, `${tempBaseDir}${tempPrefix}-${Date.now()}`);
  let savedFileName = safeFileName;

  try {
    if (Platform.OS === 'android') {
      const downloadDirUri = FileSystem.StorageAccessFramework.getUriForDirectoryInRoot('Download');
      const permission = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(downloadDirUri);

      if (!permission.granted) {
        throw new Error('다운로드 폴더 접근 권한이 필요합니다.');
      }

      let destUri: string;
      try {
        destUri = await FileSystem.StorageAccessFramework.createFileAsync(
          permission.directoryUri,
          savedFileName,
          mimeType,
        );
      } catch {
        savedFileName = appendTimestampToFileName(savedFileName);
        destUri = await FileSystem.StorageAccessFramework.createFileAsync(
          permission.directoryUri,
          savedFileName,
          mimeType,
        );
      }

      const base64 = await FileSystem.readAsStringAsync(downloaded.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await FileSystem.writeAsStringAsync(destUri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } else {
      const baseDocDir = FileSystem.documentDirectory;
      if (!baseDocDir) {
        throw new Error('문서 저장 경로를 찾을 수 없습니다.');
      }

      let destUri = `${baseDocDir}${savedFileName}`;
      try {
        await FileSystem.copyAsync({ from: downloaded.uri, to: destUri });
      } catch {
        savedFileName = appendTimestampToFileName(savedFileName);
        destUri = `${baseDocDir}${savedFileName}`;
        await FileSystem.copyAsync({ from: downloaded.uri, to: destUri });
      }
    }
  } finally {
    await FileSystem.deleteAsync(downloaded.uri, { idempotent: true }).catch(() => undefined);
  }

  return {
    fileName: savedFileName,
    destinationLabel: Platform.OS === 'android' ? '다운로드 폴더' : '앱 문서 폴더',
  };
}
