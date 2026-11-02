/**
 * Zählt, wie weit ein Token in seinem aktuellen Kampfzug gelaufen ist.
 * Wird zu Beginn des eigenen Zugs zurückgesetzt. Spurten verdoppelt das Budget.
 */
import { setting } from "./const.js";

const state = new Map(); // tokenId -> { key, spent, dashes }

function turnKey() {
  const c = game.combat;
  if (!c?.started) return null;
  return `${c.id}:${c.round}`;
}

function get(tokenId) {
  const key = turnKey();
  let s = state.get(tokenId);
  if (!s || s.key !== key) {
    s = { key, spent: 0, dashes: 0 };
    state.set(tokenId, s);
  }
  return s;
}

export const Movement = {
  /** Verbrauchte Strecke (in Szeneneinheiten, z. B. Fuß). */
  spent(tokenId) {
    if (!turnKey()) return 0;
    return get(tokenId).spent;
  },
  dashes(tokenId) {
    if (!turnKey()) return 0;
    return get(tokenId).dashes;
  },
  addDash(tokenId) {
    if (!turnKey()) return;
    get(tokenId).dashes += 1;
  },
  add(tokenId, distance) {
    if (!turnKey() || !distance) return;
    get(tokenId).spent += distance;
  },
  reset(tokenId) {
    state.delete(tokenId);
  },
  clearAll() {
    state.clear();
  }
};

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

const origins = new Map();

export function registerMovementHooks(onChange) {
  // Foundry v13+: moveToken liefert die tatsächlich gelaufene Strecke (inkl. Wegpunkte).
  let hasMoveHook = false;
  Hooks.on("moveToken", (doc, movement) => {
    hasMoveHook = true;
    if (!setting("trackMovement")) return;
    const passed = movement?.passed;
    const dist = Number(passed?.cost ?? passed?.distance);
    if (Number.isFinite(dist) && dist > 0 && dist < 1e6) Movement.add(doc.id, dist);
    onChange(doc);
  });

  // Fallback: Luftlinie zwischen alter und neuer Position.
  Hooks.on("preUpdateToken", (doc, changes) => {
    if (hasMoveHook) return;
    if (!("x" in changes || "y" in changes)) return;
    origins.set(doc.id, { x: doc.x, y: doc.y });
  });
  Hooks.on("updateToken", (doc, changes) => {
    if (hasMoveHook || !origins.has(doc.id)) return;
    const from = origins.get(doc.id);
    origins.delete(doc.id);
    if (!setting("trackMovement")) return;
    try {
      const to = { x: doc.x, y: doc.y };
      const d = canvas.grid.measurePath([from, to]).distance;
      Movement.add(doc.id, d);
    } catch { /* ignorieren */ }
    onChange(doc);
  });

  // Zugbeginn: Zähler des Akteurs zurücksetzen.
  Hooks.on("combatTurnChange", (combat, prior, current) => {
    const tokenId = combat.combatants.get(current?.combatantId)?.tokenId;
    if (tokenId) Movement.reset(tokenId);
    onChange(null);
  });
  Hooks.on("updateCombat", (combat, changes) => {
    if (!("turn" in changes || "round" in changes)) return;
    const tokenId = combat.combatant?.tokenId;
    if (tokenId) Movement.reset(tokenId);
    onChange(null);
  });
  Hooks.on("deleteCombat", () => {
    Movement.clearAll();
    onChange(null);
  });
}
