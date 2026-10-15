// Browser-direct upload in the three steps the platform requires. Shared by the
// status composer, the media library and the messages page so the sequence can
// never be half-implemented on one screen.
//
//   1. ask our API for a signed PUT URL (+ the key to commit later)
//   2. PUT the bytes straight to object storage
//   3. commit → the server indexes it and we keep the public URL
//
// The returned `publicUrl` is ABSOLUTE on purpose: it is handed to the WAME API,
// which fetches the media from its own servers.
import { publicUrl } from "@/_core/public-url";

export type UploadKind = "image" | "video" | "audio";

export interface UploadResult {
  key: string;
  name: string;
  publicUrl: string;
}

export interface UploadDeps {
  getUploadUrl: (input: { name: string; contentType: string }) => Promise<{
    key: string;
    uploadUrl: string;
    publicPath: string;
  }>;
  commit: (input: {
    key: string;
    name: string;
    kind: UploadKind;
    publicUrl: string;
  }) => Promise<unknown>;
  onProgress?: (phase: "signing" | "uploading" | "committing") => void;
}

export async function uploadMedia(file: File, kind: UploadKind, deps: UploadDeps): Promise<UploadResult> {
  const contentType = file.type || defaultContentType(file.name, kind);

  deps.onProgress?.("signing");
  const { key, uploadUrl, publicPath } = await deps.getUploadUrl({ name: file.name, contentType });

  deps.onProgress?.("uploading");
  const res = await fetch(uploadUrl, { method: "PUT", body: file });
  if (!res.ok) {
    throw new Error(`O envio do arquivo falhou (${res.status}). Tente novamente.`);
  }

  // absolute URL the WAME servers can fetch
  const absolute = publicUrl(publicPath);

  deps.onProgress?.("committing");
  await deps.commit({ key, name: file.name, kind, publicUrl: absolute });

  return { key, name: file.name, publicUrl: absolute };
}

/** Browsers occasionally report an empty type for a valid file — derive it from
 *  the extension so the platform's content-type whitelist still matches. */
function defaultContentType(name: string, kind: UploadKind): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
  };
  if (map[ext]) return map[ext];
  return kind === "image" ? "image/jpeg" : kind === "video" ? "video/mp4" : "audio/mpeg";
}

export const UPLOAD_PHASE_LABEL: Record<"signing" | "uploading" | "committing", string> = {
  signing: "Preparando o envio…",
  uploading: "Enviando o arquivo…",
  committing: "Registrando o arquivo…",
};
