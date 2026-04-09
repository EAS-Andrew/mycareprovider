import "server-only";

/**
 * Header-safe string sanitiser for outbound email.
 *
 * CRLF injection via user-controlled header fields (subject, from, reply-to,
 * display names interpolated into subjects) is the email equivalent of a
 * classic HTTP response-splitting attack: a `\r\n` in any field that ends up
 * on an SMTP header line lets an attacker inject extra headers
 * (`Bcc:`, `Reply-To:`) or terminate the header block early and graft body
 * content. Resend may or may not sanitise this for us - we cannot rely on
 * that contractually - so we strip at our own boundary.
 *
 * Policy: strip `\r`, `\n`, `\0`, and every other C0 control character
 * (< 0x20) except `\t` (which is legal whitespace in headers). Trailing
 * whitespace is trimmed. Length is NOT enforced here; call sites apply the
 * per-field length check separately.
 *
 * The function is intentionally total: it never throws. Upstream validation
 * catches empty-after-strip cases for fields that must be non-empty.
 */
export function sanitizeHeader(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // Drop \r (0x0D), \n (0x0A), \0 (0x00), and all other C0 controls
    // except horizontal tab (0x09).
    if (code === 0x09 || code >= 0x20) {
      out += value[i];
    }
  }
  return out.trim();
}
