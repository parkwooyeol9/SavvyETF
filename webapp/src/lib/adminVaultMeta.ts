/** Vercel request bodies stay under ~4.5MB, so every file is sent in chunks. */
export const VAULT_CHUNK_BYTES = 3_000_000;
export const VAULT_MAX_FILE_BYTES = 30 * 1024 * 1024;
export const VAULT_MAX_FILES_PER_POST = 10;
export const VAULT_MAX_TITLE = 120;
export const VAULT_MAX_MEMO = 4000;

export type VaultFile = {
  id: string;
  filename: string;
  size: number;
  contentType: string;
  key: string;
};

export type VaultPost = {
  id: string;
  title: string;
  memo: string;
  files: VaultFile[];
  created_at: string;
  updated_at: string;
};

/** Client view: object keys stay server-side. */
export type VaultPostView = Omit<VaultPost, "files"> & {
  files: Array<Omit<VaultFile, "key">>;
};

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isVaultPdf(file: { filename: string; contentType?: string }): boolean {
  return /\.pdf$/i.test(file.filename) || file.contentType === "application/pdf";
}

export function formatVaultSize(bytes: number): string {
  if (!bytes) return "0KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
