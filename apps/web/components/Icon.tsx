import type { IconType } from "react-icons";

/*
 * Phosphor Bold (react-icons/pi). Chosen over thin-stroke sets because its heavy, round-capped
 * strokes sit next to the logo's dashes and the custom navigation icons without clashing.
 * Every glyph below is picked for what it says: eye = visibility, lock = private, key = spend key,
 * link = payment link, wallet = a wallet, receipt = a fee, calendar = a date range.
 */
export {
  PiArrowUpRightBold as GlyphOut,
  PiCalendarBlankBold as GlyphCalendar,
  PiCheckBold as GlyphCheck,
  PiClockBold as GlyphPending,
  PiCopyBold as GlyphCopy,
  PiEyeBold as GlyphEye,
  PiEyeSlashBold as GlyphEyeOff,
  PiFileCsvBold as GlyphCsv,
  PiHandCoinsBold as GlyphRequest,
  PiInfoBold as GlyphInfo,
  PiKeyBold as GlyphKey,
  PiLinkSimpleBold as GlyphLink,
  PiLockSimpleBold as GlyphLock,
  PiMoonBold as GlyphMoon,
  PiPaletteBold as GlyphPalette,
  PiReceiptBold as GlyphReceipt,
  PiSignOutBold as GlyphSignOut,
  PiSunBold as GlyphSun,
  PiUserCircleBold as GlyphUser,
  PiUserPlusBold as GlyphUserPlus,
  PiWalletBold as GlyphWallet,
} from "react-icons/pi";
export { FcGoogle as GlyphGoogle } from "react-icons/fc";

export function Icon({ as: Glyph, size = 18 }: { as: IconType; size?: number }) {
  return <Glyph size={size} className="ic" aria-hidden="true" focusable="false" />;
}
