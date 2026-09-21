import QRCode from "qrcode";

export function joinUrl(code) {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  return `${location.origin}${base}/#/join?code=${encodeURIComponent(code)}`;
}

export function codeFromInviteText(text) {
  const value = String(text || "").trim();
  const query = value.match(/[?&]code=([^&]+)/i);
  if (query) return decodeURIComponent(query[1]);
  const fromPath = value.match(/#\/join\/([^/?#]+)/i);
  if (fromPath) return decodeURIComponent(fromPath[1]);
  return value;
}

export async function qrDataUrl(text) {
  return QRCode.toDataURL(text, {
    width: 280,
    margin: 1,
    color: { dark: "#0b1220", light: "#f6f1e6" },
  });
}

export async function copyText(value) {
  const text = String(value || "");
  if (!text) throw new Error("Nothing to copy.");
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "true");
    box.style.position = "fixed";
    box.style.left = "-9999px";
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    box.remove();
    return true;
  }
}

export async function shareInvite({ url, code, name }) {
  const title = "Join our household on Our Money Hub";
  const text = `Join ${name || "our household"} in Our Money Hub.\nLink: ${url}\nCode: ${code}`;
  if (navigator.share) {
    await navigator.share({ title, text, url });
    return "shared";
  }
  await copyText(`${url}\n${code}`);
  return "copied";
}

export async function scanQrFromFile(file) {
  if (!file) throw new Error("Choose a photo of the household QR code.");
  if (!window.BarcodeDetector) {
    throw new Error("This browser cannot read QR photos. Paste the join code or open the invite link instead.");
  }
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  const bitmap = await createImageBitmap(file);
  const codes = await detector.detect(bitmap);
  const raw = codes[0]?.rawValue;
  if (!raw) throw new Error("No QR code was found in that picture.");
  return codeFromInviteText(raw);
}
