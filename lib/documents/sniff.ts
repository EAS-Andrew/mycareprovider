import "server-only";

/**
 * Server-side MIME sniffing for uploaded files (H-1).
 *
 * Reads the first 16 bytes of the file and matches them against a small
 * allow-list of magic-byte signatures. The declared `file.type` sent by
 * the browser is never trusted on its own: an attacker can upload an
 * arbitrary binary while claiming `Content-Type: application/pdf`. We
 * compare the sniffed type against the declared type and reject on
 * mismatch.
 *
 * This is intentionally minimal - no external `file-type` package. The
 * signatures here cover the allow-list in `./mime.ts` (PDF, PNG, JPEG,
 * WEBP). HEIC is allow-listed but has a variable `ftyp` box; we accept
 * any declared `image/heic` that starts with the ISO-BMFF "ftyp" marker
 * at bytes 4-8.
 */

export type SniffedMime =
  | "application/pdf"
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/heic"
  | null;

function matches(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

function asciiAt(
  bytes: Uint8Array,
  offset: number,
  text: string,
): boolean {
  if (bytes.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

export function sniffMimeType(bytes: Uint8Array): SniffedMime {
  // PDF: "%PDF-"
  if (asciiAt(bytes, 0, "%PDF-")) return "application/pdf";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  // JPEG: FF D8 FF
  if (matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // WEBP: "RIFF" .... "WEBP"
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) {
    return "image/webp";
  }
  // HEIC: ISO-BMFF "ftyp" at offset 4, brand "heic"/"heix"/"mif1" in the box
  if (asciiAt(bytes, 4, "ftyp")) {
    if (
      asciiAt(bytes, 8, "heic") ||
      asciiAt(bytes, 8, "heix") ||
      asciiAt(bytes, 8, "mif1") ||
      asciiAt(bytes, 8, "heim") ||
      asciiAt(bytes, 8, "heis")
    ) {
      return "image/heic";
    }
  }
  return null;
}

/**
 * Reads the first 16 bytes of a `File`, sniffs the type, and rejects if
 * the sniffed type does not match the declared type. Returns the
 * authoritative mime string to persist (the sniffed value).
 */
export async function assertSniffedMime(
  file: File,
  declaredType: string,
): Promise<string> {
  const slice = file.slice(0, 16);
  const buf = new Uint8Array(await slice.arrayBuffer());
  const sniffed = sniffMimeType(buf);
  if (sniffed === null) {
    throw new Error(
      `File content does not match any allowed type (declared ${declaredType})`,
    );
  }
  if (sniffed !== declaredType) {
    throw new Error(
      `File content (${sniffed}) does not match declared type (${declaredType})`,
    );
  }
  return sniffed;
}
