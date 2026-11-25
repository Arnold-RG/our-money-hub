import QRCode from "qrcode";

/** Client-side only. Never log the URI or send it off-device. */
export const OTP_QR_OPTIONS = {
  type: "svg" as const,
  margin: 4,
  width: 288,
  errorCorrectionLevel: "M" as const,
  color: { dark: "#111111", light: "#ffffff" },
};

export function otpauthQrSvg(otpauthUri: string): Promise<string> {
  if (!otpauthUri.startsWith("otpauth://")) {
    return Promise.reject(new Error("Not an otpauth URI"));
  }
  return QRCode.toString(otpauthUri, OTP_QR_OPTIONS);
}
