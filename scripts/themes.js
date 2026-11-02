/**
 * Design-Verwaltung. Eingebaut: "rustic" (Holz & Bronze) und "gothic" (Gotik & Pergament).
 * Andere Module (z. B. der Themer) können eigene Designs registrieren:
 *
 *   game.modules.get("ascandir-combat-hud").api.registerTheme({
 *     id: "mein-design", label: "Mein Design",
 *     vars: { "--ach-frame": "#c9a24a", ... },   // CSS-Variablen (siehe README)
 *     css: ".ach-theme-mein-design .ach-tile { ... }" // optional: eigenes CSS
 *   });
 */
import { ID, t } from "./const.js";

const themes = new Map();

export function builtinThemes() {
  themes.set("rustic", { id: "rustic", label: "ACH.Theme.Rustic", builtin: true });
  themes.set("gothic", { id: "gothic", label: "ACH.Theme.Gothic", builtin: true });
}

export function themeChoices() {
  const out = {};
  for (const th of themes.values()) out[th.id] = th.label;
  return out;
}

export function registerTheme(theme) {
  if (!theme?.id) throw new Error(`${ID} | registerTheme: id fehlt`);
  const id = String(theme.id).replace(/[^a-z0-9_-]/gi, "-");
  themes.set(id, { ...theme, id, label: theme.label ?? id });
  injectThemeCss(themes.get(id));
  syncChoices();
  return id;
}

export function unregisterTheme(id) {
  const th = themes.get(id);
  if (!th || th.builtin) return false;
  themes.delete(id);
  document.getElementById(`ach-theme-style-${id}`)?.remove();
  syncChoices();
  return true;
}

export function getTheme(id) {
  return themes.get(id) ?? themes.get("rustic");
}

export function listThemes() {
  return [...themes.values()].map(({ id, label, builtin }) => ({ id, label: game.i18n.localize(label), builtin: !!builtin }));
}

function injectThemeCss(theme) {
  if (theme.builtin) return;
  const sel = `.ach-theme-${theme.id}`;
  const vars = Object.entries(theme.vars ?? {})
    .filter(([k]) => k.startsWith("--"))
    .map(([k, v]) => `${k}: ${v};`)
    .join(" ");
  const css = `${vars ? `${sel} { ${vars} }\n` : ""}${theme.css ?? ""}`;
  let style = document.getElementById(`ach-theme-style-${theme.id}`);
  if (!style) {
    style = document.createElement("style");
    style.id = `ach-theme-style-${theme.id}`;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

function syncChoices() {
  const s = game.settings?.settings?.get(`${ID}.theme`);
  if (s) s.choices = themeChoices();
}

export function themeLabel(id) {
  const th = themes.get(id);
  return th ? game.i18n.localize(th.label) : t("Theme.Rustic");
}
