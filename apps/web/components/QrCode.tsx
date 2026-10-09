"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** Always dark on white, even in dark mode, so phone cameras can read it. */
export function QrCode({ value }: { value: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toString(value, { type: "svg", margin: 1, color: { dark: "#141416", light: "#ffffff" } }).then((s) => {
      if (live) setSvg(s);
    });
    return () => {
      live = false;
    };
  }, [value]);
  return (
    <div className="qr" role="img" aria-label="QR code for your payment link">
      {/* Output of the qrcode library for our own link: paths only. */}
      <div dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}
