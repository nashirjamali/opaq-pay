# DESIGN.md

Direction for Opaq Pay UI. Authored from the owner's answers; colors are read from the supplied logo files.

- **Mood:** calm, like a bank. Trustworthy before exciting.
- **Theme:** light by default, with a working light/dark toggle. Both must stay fully functional.
- **Logo:** supplied by the owner (`Downloads/Opaq`), cropped copies in `docs/design/wireframe/assets/`.
- **Brand blue:** logo blue `#3772FF` under its own 25% black overlay renders as `#2A55C8` in light mode (white text passes AA); `#6C97FF` in dark mode (dark text on it passes AA). Ink `#141416`, paper `#FCFCFD`.
- **Product shape:** product first. `/` is a marketing home (hero, how it works, what is public, roadmap) that links straight into the demo. The app opens as a demo with sample data; any action that touches an account asks the user to create an account.
- Dial: ENERGY 2 / RHYTHM 2 / MOTION 2. Raised from 1 / 2 / 1 after the owner found the first pass "not impressive". Still calm: one saturated surface (the balance hero), one identity motif (the mark's dashes), and motion for orientation only (page rise, balance count-up, bars growing, dialog pop), all off under reduced motion.

## Coinbank direction (Figma "Opaq Pay", light mode implemented first)

- **Source:** the Coinbank design system imported in the Figma file. Tokens live in `apps/web/app/globals.css`.
- **Colors:** Primary `#5235E8` (buttons, links, active nav, chart bars), Black `#0E0637` (balance card, headings, strong chips), Secondary lime `#DAF727` (the one key action, money-in tiles, icon chips, today's bar; always under Black text, never as text). Neutral ramp for text and borders (`#131316` ink, `#717184` muted, `#E3E3E8` lines). Primary Shades for tints.
- **Type:** DM Sans; mono (IBM Plex Mono) only for addresses and links. Scale follows Coinbank: 12 / 14 / 16 / 18 / 24 / 40.
- **Shape:** 8px controls and cards, 12px dialogs, 20px balance card. Cards are flat (border, no shadow); only dialogs lift.
- **Icons:** Coinbank line icons and circle badges in `components/CbIcon.tsx`. The theme toggle (moon/sun) and Google mark are the only non-Coinbank glyphs.
- **Layout:** 1100px and up: sidebar with the wordmark, header with page title and controls. 821 to 1099px: full-width header with logo, side nav. 820px and below: bottom tab bar.
- **Dark mode:** neutral black base (`#131316`) with cards one step lighter, Primary balance card, lime accents unchanged, links in Primary Shade 400. Matches the Figma dark frames; all of it lives in the `:root[data-theme="dark"]` tokens plus a short refinements block in `globals.css`.
- **Logo:** the full wordmark (`public/brand/logo-*.svg`) in the sidebar and the mark alone (`mark-*.svg`) on small screens and the payer page, both exported from the Figma file. The dark wordmark is `#F4F4F6`.
