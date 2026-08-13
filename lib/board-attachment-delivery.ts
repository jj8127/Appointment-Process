export type BoardAttachmentFile<TSource> = {
  source: TSource;
  fileName: string;
  fileSize: number;
  mimeType: string;
  fileType: 'image' | 'file';
  sortOrder?: number;
};

export type BoardAttachmentManifest = {
  phase: 'upload' | 'finalize';
  files: {
    storagePath: string;
    signedUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    fileType: 'image' | 'file';
    sortOrder?: number;
  }[];
};

export type BoardAttachmentDeliveryDeps<TSource> = {
  sign: (
    files: (
      Omit<BoardAttachmentFile<TSource>, 'source' | 'sortOrder'>
      & { storagePath?: string }
    )[],
  ) => Promise<{ storagePath: string; signedUrl: string }[]>;
  upload: (source: TSource, signedUrl: string, mimeType: string) => Promise<void>;
  finalize: (
    files: Omit<BoardAttachmentManifest['files'][number], 'signedUrl'>[],
  ) => Promise<void>;
  areFinalized: (storagePaths: string[]) => Promise<boolean>;
};

export type BoardAttachmentDeliveryResult = {
  complete: boolean;
  manifest: BoardAttachmentManifest | null;
};

const toFinalizeFiles = (manifest: BoardAttachmentManifest) =>
  manifest.files.map((file) => ({
    storagePath: file.storagePath,
    fileName: file.fileName,
    fileSize: file.fileSize,
    mimeType: file.mimeType,
    fileType: file.fileType,
    sortOrder: file.sortOrder,
  }));

export async function deliverBoardAttachments<TSource>(
  files: BoardAttachmentFile<TSource>[],
  pendingManifest: BoardAttachmentManifest | null,
  deps: BoardAttachmentDeliveryDeps<TSource>,
): Promise<BoardAttachmentDeliveryResult> {
  if (files.length === 0) {
    return { complete: true, manifest: null };
  }

  let manifest = pendingManifest;
  const isRetry = manifest !== null;

  if (!manifest) {
    try {
      const signed = await deps.sign(
        files.map((file) => ({
          fileName: file.fileName,
          fileSize: file.fileSize,
          mimeType: file.mimeType,
          fileType: file.fileType,
        })),
      );
      if (signed.length !== files.length) {
        return { complete: false, manifest: null };
      }
      manifest = {
        phase: 'upload',
        files: files.map((file, index) => ({
          storagePath: signed[index].storagePath,
          signedUrl: signed[index].signedUrl,
          fileName: file.fileName,
          fileSize: file.fileSize,
          mimeType: file.mimeType,
          fileType: file.fileType,
          sortOrder: file.sortOrder,
        })),
      };
    } catch {
      return { complete: false, manifest: null };
    }
  }

  if (manifest.files.length !== files.length) {
    return { complete: false, manifest };
  }

  if (isRetry && manifest.phase === 'upload') {
    try {
      const refreshed = await deps.sign(
        manifest.files.map((file) => ({
          storagePath: file.storagePath,
          fileName: file.fileName,
          fileSize: file.fileSize,
          mimeType: file.mimeType,
          fileType: file.fileType,
        })),
      );
      const samePaths = refreshed.length === manifest.files.length
        && refreshed.every(
          (signed, index) => signed.storagePath === manifest?.files[index].storagePath,
        );
      if (!samePaths) {
        return { complete: false, manifest };
      }
      manifest = {
        ...manifest,
        files: manifest.files.map((file, index) => ({
          ...file,
          signedUrl: refreshed[index].signedUrl,
        })),
      };
    } catch {
      return { complete: false, manifest };
    }
  }

  if (manifest.phase === 'upload') {
    const uploads = await Promise.allSettled(
      manifest.files.map((signedFile, index) =>
        deps.upload(files[index].source, signedFile.signedUrl, signedFile.mimeType),
      ),
    );
    if (uploads.some((result) => result.status === 'rejected')) {
      const storagePaths = manifest.files.map((file) => file.storagePath);
      try {
        await deps.finalize(toFinalizeFiles({ ...manifest, phase: 'finalize' }));
        return { complete: true, manifest: null };
      } catch {
        try {
          if (await deps.areFinalized(storagePaths)) {
            return { complete: true, manifest: null };
          }
        } catch {
          // Keep the upload manifest so the same paths can be retried.
        }
      }
      return { complete: false, manifest };
    }
    manifest = { ...manifest, phase: 'finalize' };
  }

  const storagePaths = manifest.files.map((file) => file.storagePath);
  if (isRetry) {
    try {
      if (await deps.areFinalized(storagePaths)) {
        return { complete: true, manifest: null };
      }
    } catch {
      // Retry the exact same finalize manifest. It cannot create a second path set.
    }
  }

  try {
    await deps.finalize(toFinalizeFiles(manifest));
    return { complete: true, manifest: null };
  } catch {
    try {
      if (await deps.areFinalized(storagePaths)) {
        return { complete: true, manifest: null };
      }
    } catch {
      // Keep the same manifest for a later bounded retry.
    }
    return { complete: false, manifest };
  }
}
