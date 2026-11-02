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

  reg("theme", { scope: "client", config: true, type: String, choices: themeChoices(), default: "rustic", onChange: rerender });
  reg("scale", { scope: "client", config: true, type: Number, range: { min: 0.5, max: 1.5, step: 0.05 }, default: 0.85, onChange: rerender });
  reg("left", { scope: "client", config: true, type: Number, range: { min: 0, max: 800, step: 5 }, default: 70, onChange: rerender });
  reg("bottom", { scope: "client", config: true, type: Number, range: { min: 0, max: 400, step: 5 }, default: 10, onChange: rerender });
  reg("openOnSelect", { scope: "client", config: true, type: Boolean, default: false });
  reg("openOnCombat", { scope: "client", config: true, type: Boolean, default: true });
  reg("hideFoundryUi", { scope: "client", config: true, type: Boolean, default: true, onChange: rerender });
  reg("showTooltips", { scope: "client", config: true, type: Boolean, default: true });
  reg("rangeRing", { scope: "client", config: true, type: Boolean, default: true });
  reg("limitedFeaturesInBar", { scope: "client", config: true, type: Boolean, default: true, onChange: rerender });
  reg("showEmptyPanels", { scope: "client", config: true, type: Boolean, default: false, onChange: rerender });
  reg("hideUnprepared", { scope: "world", config: true, type: Boolean, default: true, onChange: rerender });
  reg("switchEquip", { scope: "world", config: true, type: Boolean, default: true });
  reg("trackMovement", { scope: "world", config: true, type: Boolean, default: true, onChange: rerender });
  reg("trackEconomy", { scope: "world", config: true, type: Boolean, default: true, onChange: rerender });
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
