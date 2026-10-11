# DESIGN.md

Direction for Opaq Pay UI. Authored from the owner's answers; colors are read from the supplied logo files.

- **Mood:** confident and colorful, but still honest. Money software that feels alive without hiding what is public. Trust comes from plain copy and visible limits, not from muted color.
- **Theme:** light by default, with a working light/dark toggle. Both must stay fully functional.
- **Logo:** supplied by the owner (`Downloads/Opaq`), cropped copies in `docs/design/wireframe/assets/`.
- **Brand color:** Primary `#5235E8` from the Coinbank system, paired with Black `#0E0637` and Secondary lime `#DAF727` (see the style section below). The earlier logo-blue values (`#3772FF` / `#2A55C8`) are retired.
- **Product shape:** product first. `/` is a marketing home (hero, how it works, what is public, roadmap) that links straight into the demo. The app opens as a demo with sample data; any action that touches an account asks the user to create an account.
- Dial: ENERGY 3 / RHYTHM 2 / MOTION 2. Raised again (was 2 / 2 / 2, first 1 / 2 / 1) because the owner wants the product richer and more colorful, with the Secondary color used on purpose across the page. Motion stays for orientation only (page rise, balance count-up, bars growing, dialog pop) and is off under reduced motion.

## Coinbank direction (Figma "Opaq Pay", light mode implemented first)

- **Source:** the Coinbank design system imported in the Figma file. Tokens live in `apps/web/app/globals.css`.
- **Colors:** Primary `#5235E8` (buttons, links, active nav, chart bars), Black `#0E0637` (balance card, headings, strong chips), Secondary lime `#DAF727` (key actions, money-in tiles, icon chips, check marks on dark surfaces, status tags such as Read-only, the shield, today's bar; always under Black text, never as text on light backgrounds). Neutral ramp for text and borders (`#131316` ink, `#717184` muted, `#E3E3E8` lines). Primary Shades for tints and section washes. Three core colors plus the lime is the whole palette; no extra hues.
- **Type:** DM Sans; mono (IBM Plex Mono) only for addresses and links. Scale follows Coinbank: 12 / 14 / 16 / 18 / 24 / 40.
- **Shape:** 8px controls and cards, 12px dialogs, 20px balance card. Cards are flat (border, no shadow); only dialogs lift.
- **Icons:** Coinbank line icons and circle badges in `components/CbIcon.tsx`. The theme toggle (moon/sun) and Google mark are the only non-Coinbank glyphs.
- **Layout:** 1100px and up: sidebar with the wordmark, header with page title and controls. 821 to 1099px: full-width header with logo, side nav. 820px and below: no tab bar; a header menu button opens the sidebar as a drawer. The light/dark toggle is a row in the sidebar after Settings (the payer page keeps a round icon button).
- **Dark mode:** neutral black base (`#131316`) with cards one step lighter, Primary balance card, lime accents unchanged, links in Primary Shade 400. Matches the Figma dark frames; all of it lives in the `:root[data-theme="dark"]` tokens plus a short refinements block in `globals.css`.
- **Logo:** the full wordmark (`public/brand/logo-*.svg`) in the sidebar and the mark alone (`mark-*.svg`) on small screens and the payer page, both exported from the Figma file. The dark wordmark is `#F4F4F6`.

## Rich style (owner decision, 2026-10)

The owner chose to keep the Secondary color and the layered decoration instead of trimming them. These are deliberate, so they are written down here with their reasons.

- **Lime is a second brand color, not a rare accent.** It marks anything that is good news or a primary move: money in, the shield, the key button, icon chips, check marks on dark cards, positive status tags. Reason: it is what separates this product from a generic purple-and-white fintech page, and the owner asked for a more colorful product. Limit: it is always a fill under Black text (or a mark on a Black or Primary surface); never lime text on white, never lime glow, and never more than one lime button on a screen.
- **Layered panel pattern (the Coinbank card background)** is the identity motif for dark and Primary surfaces: balance card, private card, notice, call to action, footer. Reason: it ties the marketing page to the app's balance card. Limit: only on solid Black or Primary surfaces, one pattern per surface, always behind content, never animated.
- **Section backgrounds** on the landing page (vertical rules, soft diagonal panels, Primary Shade washes) separate sections and add depth. Limit: they stay behind content at low opacity, and they are the same set in every section, not a new texture per section.
- **Corner radii** on the landing page follow the Coinbank frames: 8 controls, 16 cards, 20 large slabs, 24 for the hero illustration. The app keeps 8 / 12 / 20.
- **Honesty rules still apply to the richer style** and are not negotiable: sample data and illustrations are labelled as examples, unshipped features say "Coming soon" or "planned", and legal pages are not implied until they exist. Decoration never replaces a fact.
