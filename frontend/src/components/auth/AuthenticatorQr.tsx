"use client";
import { useEffect, useState } from "react";
import { otpauthQrSvg } from "@/lib/otpQr";

export function AuthenticatorQr({ otpauthUri }: { otpauthUri: string }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    otpauthQrSvg(otpauthUri).then((next) => {
      if (!cancelled) setSvg(next);
    }).catch(() => {
      if (!cancelled) setSvg(null);
    });
    return () => { cancelled = true; };
  }, [otpauthUri]);

  if (!svg) {
    return <div aria-hidden className="mx-auto bg-white" style={{ width: 288, height: 288 }} />;
  }

  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    <div className="mx-auto rounded-2xl bg-white p-3" style={{ width: 312 }}>
      <img
        src={src}
        width={288}
        height={288}
        alt="QR code to add this account in your authenticator app"
        className="block h-[288px] w-[288px] bg-white"
      />
    </div>
  );
}
