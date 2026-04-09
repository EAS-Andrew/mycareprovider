# Brand Colors

MyCareProvider has two brand colors, and each one belongs to a different audience. Color is how people know which side of the app they are on.

## Blue - for care receivers

Blue is the color of the receiving side of the app. It belongs to the people who need care and the families arranging it: care recipients, family members, and anyone managing care on behalf of a loved one.

Blue should feel calm, trustworthy, and reassuring. It is the color a family member sees when they are finding a provider, booking visits, or checking in on someone they love.

Anywhere a care receiver is looking at the app, blue is the brand color. Their logo is blue, their buttons are blue, their highlights are blue.

## Purple - for care providers

Purple is the color of the delivering side of the app. It belongs to the people who provide care: individual care providers and the companies that employ them.

Purple should feel professional, distinct, and work-oriented. It is the color a care provider sees when they are managing their schedule, reviewing clients, or tracking their visits.

Anywhere a care provider is looking at the app, purple is the brand color. Their logo is purple, their buttons are purple, their highlights are purple.

## Keeping the two sides separate

Blue and purple never share a logged-in screen. Once someone has signed in, the whole interface commits to one color based on who they are. A care provider should never see stray blue accents, and a care receiver should never see stray purple ones. The split is the whole point: users should be able to tell at a glance which side of the service they are looking at.

The only time the two colors appear together is on shared, pre-login surfaces where the audience is not yet known: the public marketing site, the landing page, and sign-in / sign-up flows. In those contexts the unified blue-and-purple mark is used to represent the brand as a whole. Transactional emails sent before the recipient has a role (for example, the initial sign-up confirmation) also use the unified mark. Once a role is known, every subsequent email to that recipient uses their side's color.

## Admin - neutral grays

Administrators are not an audience. They are the people who operate the platform on behalf of both sides: verifying providers, triaging disputes and safeguarding reports, fulfilling data subject requests. They see both care receivers' and care providers' data in the same sitting, and it would be dishonest to dress an admin screen in either brand color when the admin is not the audience of the service.

Admin surfaces use **neutral grays only**, with no brand accent. The same neutral scale that serves as the canvas on receiver and provider screens becomes the primary palette on admin screens. Semantic colors (green, amber, red) still apply with the same rules. The admin logo variant `favicon-admin.svg` uses a single slate gray (`#64748b`) on the same cross shape as the other marks.

When an admin is reviewing a specific receiver's or provider's record, the admin chrome stays neutral. Embedded previews of that user's data can show the appropriate side color within a clearly-bounded preview frame, but the surrounding admin UI never inherits the color. The rule is: the admin's environment is neutral, and the user's data is visibly quoted inside it.

## Accessibility - color is never the only signal

Color tells users which side of the platform they are on, but it must not be the *only* signal that does. Users who are colorblind, using a screen reader, or viewing the app in a context where color is stripped (high-contrast mode, monochrome printing, plain-text email) need a second, non-color cue on every themed surface. This is also a WCAG 2.1 requirement (success criterion 1.4.1 Use of Color), not just a style preference.

Every themed surface carries at least one of:

- A persistent audience label in the header, visible and announced by screen readers: "Care receiver" on blue screens, "Care provider" on purple screens, "Administrator" on neutral admin screens
- A distinct heading treatment or iconography associated with the side
- An accessible name on the installed PWA, notifications, and browser tab that includes the audience label

A screen where the only indication that you are on the provider side is that it is purple is a broken screen, even if the purple is correct.

## Everything else, very sparingly

Blue and purple carry the brand. Every other color is reserved and should only appear where it genuinely has to.

- **Neutral grays** are the canvas. Page backgrounds, body text, and borders are all neutral. This is not a brand color, it is what the brand colors sit on top of.
- **Green** means success. Use it only for confirmations and positive status like "saved" or "verified". Never for decoration, never as a stand-in for the brand.
- **Amber** means warning. Use it only when something needs attention but is not an error.
- **Red** means error or destructive. Use it only for delete actions and failure states. Never for emphasis.
- **No other colors.** Do not introduce new hues, do not reach for extra palette entries to add "visual interest", and do not mix blue and purple into gradients. If something needs to stand out, it stands out in the current side's brand color.

A good rule of thumb for any screen: most of it should be neutral, a clear share of it should be the side's brand color (blue or purple, not both), and the semantic colors should only show up where they are carrying real meaning.

## Logo variants

The four logo files in `assets/` match the rules above:

- **`favicon-blue.svg`** - the care receiver mark. Use on every screen where the audience is a care recipient or family member.
- **`favicon-purple.svg`** - the care provider mark. Use on every screen where the audience is a care provider or care company.
- **`favicon-admin.svg`** - the administrator mark in neutral slate gray. Use on every admin surface: verification console, dispute queue, safeguarding triage, DSAR and erasure admin, analytics dashboards.
- **`favicon-unified.svg`** - the combined blue-and-purple mark. Use only on public and pre-login surfaces where the audience is unknown, on the public marketing site favicon, and in transactional emails sent before the recipient has a known role.
