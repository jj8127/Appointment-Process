import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

import {
  appendMessengerAttachmentCandidates,
  MAX_MESSENGER_ATTACHMENTS,
  MESSENGER_ATTACHMENT_MIME_BY_EXTENSION,
  type SelectedMessengerAttachment,
} from './messenger-attachment-api';

// Shared by the 1:1 and group rooms so both offer the same photo and file pickers.
// Each returns the selection with the picked items appended, or null when nothing changed
// (cancelled, permission denied, or a failure that has already been shown to the user).

export async function pickMessengerFiles(
  existing: readonly SelectedMessengerAttachment[],
): Promise<SelectedMessengerAttachment[] | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({
      type: Array.from(new Set(Object.values(MESSENGER_ATTACHMENT_MIME_BY_EXTENSION))),
      copyToCacheDirectory: true,
      multiple: true,
      base64: false,
    });
    if (result.canceled) return null;
    return await appendMessengerAttachmentCandidates(
      existing,
      result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        size: asset.size,
        mimeType: asset.mimeType,
        webFile: asset.file,
      })),
    );
  } catch (error) {
    Alert.alert('파일 선택 실패', error instanceof Error ? error.message : '파일을 선택하지 못했습니다.');
    return null;
  }
}

export async function pickMessengerPhotos(
  existing: readonly SelectedMessengerAttachment[],
): Promise<SelectedMessengerAttachment[] | null> {
  if (existing.length >= MAX_MESSENGER_ATTACHMENTS) {
    Alert.alert('첨부 한도', `사진과 파일은 최대 ${MAX_MESSENGER_ATTACHMENTS}개까지 첨부할 수 있습니다.`);
    return null;
  }
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('사진 권한 필요', '사진을 첨부하려면 사진 접근 권한을 허용해 주세요.');
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_MESSENGER_ATTACHMENTS - existing.length,
      quality: 0.85,
    });
    if (result.canceled) return null;
    const selectedAt = Date.now();
    return await appendMessengerAttachmentCandidates(
      existing,
      result.assets.map((asset, index) => ({
        uri: asset.uri,
        name: asset.fileName ?? `image_${selectedAt}_${index + 1}.jpg`,
        size: asset.fileSize,
        mimeType: asset.mimeType ?? 'image/jpeg',
        webFile: asset.file,
      })),
    );
  } catch (error) {
    Alert.alert('사진 선택 실패', error instanceof Error ? error.message : '사진을 선택하지 못했습니다.');
    return null;
  }
}
