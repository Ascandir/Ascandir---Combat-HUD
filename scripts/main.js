/**
 * Ascandir - Combat HUD
 *
 * Eigenes Kampf-HUD für dnd5e im rustikalen Fantasy-Look.
 * Mit Anbindung an "Ascandir - DnD5e Mounting": Reittier-Werte im Portrait
 * und ein eigener Bereich "Reittier" mit den Aktionen des Reittiers.
 */
import { ID, t } from "./const.js";
import { CombatHud, getWeaponSets } from "./hud.js";
import { registerMovementHooks } from "./movement.js";
import { builtinThemes, themeChoices, registerTheme, unregisterTheme, listThemes } from "./themes.js";
import { touchesMountFlags } from "./mount.js";

let hud = null;

/* -------------------------------------------- */
/*  Einstellungen                               */
/* -------------------------------------------- */

function registerSettings() {
  const rerender = () => hud?.render();
  const reg = (key, data) => game.settings.register(ID, key, { name: `ACH.Settings.${key}.Name`, hint: `ACH.Settings.${key}.Hint`, ...data });
  const client = (key, type, def, extra = {}) => reg(key, { scope: "client", config: true, type, default: def, onChange: rerender, ...extra });
  const world = (key, type, def, extra = {}) => reg(key, { scope: "world", config: true, type, default: def, onChange: rerender, ...extra });

  // ---- Spieler (jeder für sich) ----
  // Aussehen
  client("theme", String, "rustic", { choices: themeChoices() });
  client("autoScale", Boolean, true);
  client("scale", Number, 1, { range: { min: 0.4, max: 1.6, step: 0.05 } });
  client("tooltipScale", Number, 1, { range: { min: 0.6, max: 1.6, step: 0.05 } });
  // Position
  client("portraitRight", Boolean, false);
  client("freePosition", Boolean, false);
  client("left", Number, 70, { range: { min: 0, max: 1200, step: 5 } });
  client("bottom", Number, 10, { range: { min: 0, max: 600, step: 5 } });
  reg("freePos", { scope: "client", config: false, type: Object, default: {}, onChange: () => hud?.applyLayout() });
  // Verhalten
  client("openOnSelect", Boolean, false);
  client("openOnCombat", Boolean, true);
  client("hideFoundryUi", Boolean, true);
  client("fadeOutInactive", Boolean, false);
  client("fadeoutDelay", Number, 5, { range: { min: 1, max: 30, step: 1 } });
  client("fadeoutOpacity", Number, 0.35, { range: { min: 0.05, max: 1, step: 0.05 } });
  client("showTooltips", Boolean, true);
  client("rangeRing", Boolean, true);
  // Inhalt
  client("showResources", Boolean, true);
  client("showBasicActions", Boolean, true);
  client("showOtherAbilities", Boolean, true);
  client("limitedFeaturesInBar", Boolean, true);
  client("condenseFeatures", Boolean, true);
  client("showEmptyPanels", Boolean, false);
  client("macroPanel", Boolean, false);

  // ---- Spielleitung (für alle) ----
  world("explodeActivities", String, "never", {
    choices: { never: "ACH.Settings.explodeActivities.never", "only-weapons": "ACH.Settings.explodeActivities.weapons", always: "ACH.Settings.explodeActivities.always" }
  });
  world("hideUnprepared", Boolean, true);
  world("switchEquip", Boolean, true);
  world("trackMovement", Boolean, true);
  world("trackEconomy", Boolean, true);
  world("mountPanel", Boolean, true);
}

/* -------------------------------------------- */
/*  Init                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  builtinThemes();
  registerSettings();

  game.keybindings.register(ID, "toggle", {
    name: "ACH.Keys.Toggle",
    editable: [],
    onDown: () => {
      hud?.toggle();
      return true;
    }
  });
  game.keybindings.register(ID, "minimize", {
    name: "ACH.Keys.Minimize",
    editable: [],
    onDown: () => {
      if (!hud?.rendered) return false;
      hud.minimized = !hud.minimized;
      hud.render(true);
      return true;
    }
  });

  const mod = game.modules.get(ID);
  mod.api = {
    get hud() {
      return hud;
    },
    open: (token) => {
      if (!hud) return;
      hud.enabled = true;
      hud.bind(token ?? canvas.tokens.controlled[0]);
    },
    close: () => hud?.toggle(false),
    toggle: (force) => hud?.toggle(force),
    registerTheme,
    unregisterTheme,
    listThemes,
    getWeaponSets
  };
});

Hooks.once("setup", () => {
  // Andere Module (z. B. der Themer) können hier ihre Designs anmelden.
  Hooks.callAll(`${ID}.registerThemes`, game.modules.get(ID).api);
});

Hooks.once("ready", () => {
  hud = new CombatHud();
  let resizeT = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => hud?.rendered && hud.render(), 150);
  });
  Hooks.on("collapseSidebar", () => hud?.rendered && hud.render());
  registerMovementHooks((doc) => {
    if (!hud?.rendered) return;
    if (!doc || doc === hud.token?.document) hud.render();
  });
});

/* -------------------------------------------- */
/*  Steuerung                                   */
/* -------------------------------------------- */

Hooks.on("getSceneControlButtons", (controls) => {
  const tokens = controls.tokens ?? controls.token;
  if (!tokens?.tools) return;
  tokens.tools["ach-toggle"] = {
    name: "ach-toggle",
    title: "ACH.Controls.Toggle",
    icon: "fas fa-shield-halved",
    order: Object.keys(tokens.tools).length,
    toggle: true,
    active: !!hud?.enabled,
    onChange: (event, active) => hud?.toggle(active)
  };
});

Hooks.on("controlToken", (token, controlled) => {
  if (!hud) return;
  if (!controlled) {
    setTimeout(() => {
      if (!canvas.tokens?.controlled.length && hud.rendered) hud.bind(null);
    }, 120);
    return;
  }
  if (hud.enabled || game.settings.get(ID, "openOnSelect")) {
    hud.enabled = true;
    hud.bind(token);
  }
});

Hooks.on("canvasTearDown", () => hud?.bind(null));

/* -------------------------------------------- */
/*  Kampf                                       */
/* -------------------------------------------- */

function onTurn(combat) {
  if (!hud) return;
  const actor = combat?.combatant?.actor;
  // Ausweichen endet zu Beginn des eigenen Zugs (nur der aktive SL setzt das um)
  if (actor?.statuses?.has?.("dodging") && game.user === game.users.activeGM) actor.toggleStatusEffect("dodging", { active: false });
  if (actor) hud.resetEconomy(actor);
  // Wer am Zug ist und es dem Spieler gehört: HUD automatisch öffnen
  if (combat?.started && game.settings.get(ID, "openOnCombat") && !hud.rendered && !game.user.isGM) {
    const tok = combat.combatant?.token?.object;
    if (tok?.actor?.isOwner) {
      hud.enabled = true;
      hud.bind(tok);
    }
  }
  if (hud.rendered) hud.render();
}

Hooks.on("combatStart", (combat) => {
  hud?.resetEconomy(null);
  if (game.settings.get(ID, "openOnCombat") && hud && !hud.rendered) {
    const tok = canvas.tokens?.controlled[0] ?? game.user.character?.getActiveTokens?.()[0];
    if (tok && combat.combatants.some((c) => c.tokenId === tok.id)) {
      hud.enabled = true;
      hud.bind(tok);
    }
  }
  hud?.render();
});
Hooks.on("combatTurnChange", (combat) => onTurn(combat));
Hooks.on("updateCombatant", () => hud?.render());
Hooks.on("createCombatant", () => hud?.render());
Hooks.on("updateCombat", (combat, changes) => {
  if ("turn" in changes || "round" in changes) onTurn(combat);
  else hud?.render();
});
Hooks.on("deleteCombat", () => {
  hud?.resetEconomy(null);
  hud?.render();
});

/* -------------------------------------------- */
/*  Datenänderungen → neu zeichnen              */
/* -------------------------------------------- */

Hooks.on("updateActor", (actor) => {
  if (hud?.concerns(actor)) hud.render();
});
for (const hook of ["createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
  Hooks.on(hook, (doc) => {
    const actor = doc.parent instanceof Actor ? doc.parent : doc.parent?.parent;
    if (hud?.concerns(actor)) hud.render();
  });
}
Hooks.on("updateToken", (doc, changes) => {
  if (!hud?.rendered) return;
  if (doc === hud.token?.document) {
    if ("actorId" in changes) return hud.bind(doc.object);
    if (touchesMountFlags(changes) || changes.texture || "name" in changes || "movementAction" in changes || changes.delta) hud.render();
    return;
  }
  // Reittier-Token geändert (z. B. Werte über Token-Delta)
  if (hud.mountDoc && doc === hud.mountDoc) hud.render();
});
Hooks.on("deleteToken", (doc) => {
  if (doc === hud?.token?.document) hud.bind(null);
  else if (hud?.rendered) hud.render();
});

/* -------------------------------------------- */
/*  Tatendrang (Action Surge)                   */
/* -------------------------------------------- */

const SURGE = /action[- ]?surge|tatendrang/i;
Hooks.on("dnd5e.postUseActivity", (activity) => {
  const item = activity?.item;
  const actor = item?.actor ?? item?.parent;
  if (!hud || !actor || !item) return;
  if (!SURGE.test(item.system?.identifier ?? "") && !SURGE.test(item.name ?? "")) return;
  hud.grantExtraAction(actor);
});
