# Opaq Pay wireframe

Interactive wireframe. No build step. From this folder:

```bash
python3 -m http.server 8799
```

then open http://localhost:8799/index.html. The "Wireframe review" strip at the top switches between demo, new account, active, loading and error states.

## Flow

1. The app opens straight into the demo (sample data, labeled as such). Navigation, reveal/hide amounts, filters and payment details all work signed out.
2. Any action that touches an account (copy link, cash out, create view access, export) opens **Create account**: Google or an existing wallet, then pick a handle.
3. After that the account starts empty. Cash out, reports and the link all work against the sample data.

## Screens

Overview, Receive, Activity (with a public/hidden detail view per payment), Cash out, Reports, Settings.

## Decisions (one line each)

- **No landing page, demo first:** the product is the pitch; people can look before they commit.
- **Create account, not "connect wallet":** the plan is an embedded wallet with Google login. An existing wallet is the second option, not the first.
- **Blue `#2A55C8`, ink, one semantic red:** blue is the logo's own shade and passes AA; red appears only for errors.
- **Manrope:** round geometric shapes close to the wordmark, with clear numerals for balances. IBM Plex Mono only for addresses and keys.
- **No icon set:** text labels carry navigation; the only graphic is the brand mark, so nothing looks like a stock library.
- **Identity motif, the diagonal dashes of the mark:** they stand in for any hidden or loading value. Balance hidden by default once signed in.
- **Cards with borders, not shadows:** calm and flat; only dialogs are elevated, to separate them from the page.
- **Radius 8 on controls, 14 on cards:** hierarchy through radius, nothing pill-shaped.
- **Overview is asymmetric (balance wide, link narrow), Receive is a form beside a preview, Activity is a list:** each screen has one job, so each has its own composition.
- **Every payment shows "Visible to anyone" and "Not visible":** privacy level is stated honestly, as the project rules require.
- **Cash out lists what becomes public and the wallet-link risk before confirming.**
- **Base shown as "coming soon":** MVP is Solana only.

## Placeholders to replace

- `opaq.example/@handle`: the real link domain is not decided.
- Sample payments and addresses: marked as sample data in the demo banner. `[REAL DATA]` marks the account provider in Settings.
- `[QR]` box: swap for a real generated QR.
- Key backup copy in Settings: depends on the embedded wallet provider (open decision).
