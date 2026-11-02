/** Gemeinsame Konstanten und kleine Helfer. */

export const ID = "ascandir-combat-hud";
export const MOUNT_ID = "ascandir-mounting";

/** Übersetzung mit Präfix "ACH." */
export const t = (key, data) =>
  data ? game.i18n.format(`ACH.${key}`, data) : game.i18n.localize(`ACH.${key}`);

/** Lokalisiert einen beliebigen Schlüssel oder gibt den Text zurück. */
export const loc = (s) => (s ? game.i18n.localize(String(s)) : "");

/** HTML-Sonderzeichen entschärfen. */
export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const signed = (n) => {
  const v = Number(n) || 0;
  return v >= 0 ? `+${v}` : `${v}`;
};

export function setting(key) {
  try {
    return game.settings.get(ID, key);
  } catch {
    return undefined;
  }
}
