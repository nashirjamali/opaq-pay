import type { Metadata } from "next";
import { ComingSoon } from "@/components/ComingSoon";
import { GlyphEye, GlyphReceipt, GlyphWallet } from "@/components/Icon";
import { IconCashOut } from "@/components/icons";
import { PageHead } from "@/components/PageHead";

export const metadata: Metadata = { title: "Cash out" };

export default function CashOutPage() {
  return (
    <>
      <PageHead title="Cash out">Move USDC from your private balance to an address you choose.</PageHead>
      <ComingSoon Icon={IconCashOut} title="Withdraw USDC 1:1" points={[
        { glyph: GlyphWallet, text: "Pick any Solana address, including a brand new one." },
        { glyph: GlyphEye, text: "The amount and the address become public. You see that before you confirm." },
        { glyph: GlyphReceipt, text: "Network fees are paid by the Opaq relayer." },
      ]}>
        Not available yet. Your balance stays where it is until it is.
      </ComingSoon>
    </>
  );
}
