import "server-only";

/**
 * Best-effort transactional email wrapper for C8 and beyond.
 *
 * Design:
 *   - `sendEmail` is a fire-and-forget helper. It MUST NOT throw into the
 *     calling Server Action; if the underlying provider errors out, we log
 *     and swallow. Email delivery is launch-blocking at the UX level but
 *     not at the transaction level - a care receiver must still be able to
 *     submit a contact request even if the SMTP vendor is down.
 *   - When `RESEND_API_KEY` is set we dynamically import `resend` and send
 *     through it. The package is NOT listed as a dependency in
 *     `package.json`; install it alongside configuring the env var (e.g.
 *     on Vercel). This keeps the default local/dev install lean.
 *   - When the env var is absent we log `[email dev]` to stdout and append
 *     to an in-memory `__devOutbox` array the test harness can assert
 *     against via `__getDevOutbox()` / `__clearDevOutbox()`.
 *
 * Theming: every transactional email is themed by recipient role per the
 * PID "Role-addressed surfaces" rule (docs/pid.md). A receiver always sees
 * mail from `receiver@notifications.*`; a provider always sees mail from
 * `provider@notifications.*`. Admins get a neutral address.
 */

export type EmailRole =
  | "receiver"
  | "family_member"
  | "provider"
  | "provider_company"
  | "admin";

export type SendEmailParams = {
  to: string;
  subject: string;
  body: string;
  role: EmailRole;
};

// Themed `from` addresses. The hostname `notifications.mycareprovider.test`
// is a placeholder; swap to the real domain at deploy time via DNS / Resend
// domain verification. Keeping the local-part role-specific is the actual
// theming contract - receivers never see a `provider@` sender, and vice
// versa, so a pre-role sign-up confirmation would use the unified mark in
// a different wrapper (not this one).
const FROM_BY_ROLE: Record<EmailRole, string> = {
  receiver: "MyCareProvider <receiver@notifications.mycareprovider.test>",
  family_member: "MyCareProvider <receiver@notifications.mycareprovider.test>",
  provider: "MyCareProvider <provider@notifications.mycareprovider.test>",
  provider_company:
    "MyCareProvider <provider@notifications.mycareprovider.test>",
  admin: "MyCareProvider <admin@notifications.mycareprovider.test>",
};

export type DevOutboxEntry = {
  to: string;
  from: string;
  subject: string;
  body: string;
  role: EmailRole;
  sentAt: string;
};

// Module-local so tests in the same process can read it. Not exported as a
// mutable reference; callers use the accessors below.
const __devOutbox: DevOutboxEntry[] = [];

/**
 * Read the dev outbox. Returns a defensive copy so callers cannot mutate
 * the buffer.
 */
export function __getDevOutbox(): readonly DevOutboxEntry[] {
  return __devOutbox.slice();
}

/**
 * Clear the dev outbox. Intended for test setup/teardown only.
 */
export function __clearDevOutbox(): void {
  __devOutbox.length = 0;
}

/**
 * Dynamically import `resend` without letting the bundler try to resolve it
 * at build time - the package is optional. We wrap the import in a runtime
 * `Function(...)` so webpack/turbopack cannot see the literal module name
 * and therefore cannot fail the build when the dep is not installed.
 */
async function loadResend(): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const importer = new Function(
    "specifier",
    "return import(specifier);",
  ) as (specifier: string) => Promise<unknown>;
  return importer("resend");
}

/**
 * Best-effort transactional email send.
 *
 * Never throws. On any failure the error is logged via `console.warn` and
 * the call returns normally so Server Actions remain transactional.
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const { to, subject, body, role } = params;
  const from = FROM_BY_ROLE[role];

  if (!process.env.RESEND_API_KEY) {
    console.info("[email dev]", { to, subject, role });
    __devOutbox.push({
      to,
      from,
      subject,
      body,
      role,
      sentAt: new Date().toISOString(),
    });
    return;
  }

  if (!to || to.trim().length === 0) {
    console.warn("[email] empty `to` address - skipping send", {
      subject,
      role,
    });
    return;
  }

  try {
    const mod = (await loadResend()) as {
      Resend: new (key: string) => {
        emails: {
          send: (args: {
            from: string;
            to: string;
            subject: string;
            text: string;
          }) => Promise<unknown>;
        };
      };
    };
    const client = new mod.Resend(process.env.RESEND_API_KEY);
    await client.emails.send({ from, to, subject, text: body });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[email] send failed (best-effort, swallowed)", {
      to,
      subject,
      role,
      error: message,
    });
  }
}
