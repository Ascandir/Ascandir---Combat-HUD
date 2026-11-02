/**
 * Anbindung an "Ascandir - DnD5e Mounting".
 * Fragt ab, ob ein Token gerade reitet und auf welchem Reittier.
 */
import { MOUNT_ID } from "./const.js";

export function mountingActive() {
  return !!game.modules.get(MOUNT_ID)?.active;
}

/** Reittier-TokenDocument eines Reiters oder null. */
export function getMountOf(tokenLike) {
  if (!mountingActive() || !tokenLike) return null;
  const doc = tokenLike.document ?? tokenLike;
  if (!(doc instanceof foundry.abstract.Document)) return null;
  const api = game.modules.get(MOUNT_ID)?.api;
  try {
    if (api?.getMount) return api.getMount(doc) ?? null;
  } catch { /* Fallback unten */ }
  const f = doc.flags?.[MOUNT_ID]?.mounted;
  if (!f?.mountId) return null;
  const mount = doc.parent?.tokens.get(f.mountId);
  if (!mount || mount.flags?.[MOUNT_ID]?.riddenBy !== doc.id) return null;
  return mount;
}

/** Reiter eines Reittier-Tokens oder null. */
export function getRiderOf(tokenLike) {
  if (!mountingActive() || !tokenLike) return null;
  const doc = tokenLike.document ?? tokenLike;
  const api = game.modules.get(MOUNT_ID)?.api;
  try {
    if (api?.getRider) return api.getRider(doc) ?? null;
  } catch { /* ignorieren */ }
  return null;
}

/** Ändert sich etwas an den Reit-Flags? */
export function touchesMountFlags(changes) {
  return changes?.flags?.[MOUNT_ID] !== undefined || changes?.[`flags.${MOUNT_ID}`] !== undefined;
}
