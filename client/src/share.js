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

export function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
