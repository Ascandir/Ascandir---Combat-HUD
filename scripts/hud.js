/**
 * Das Kampf-HUD: Portrait, Bewegung, Aktionsbereiche, Reittier, Waffensets, Tooltips.
 * Komplett eigener Aufbau, angelehnt an den bekannten Argon-Aufbau.
 */
import { ID, t, loc, esc, setting } from "./const.js";
import {
  resourcesData, RESOURCE_ICONS, ACTIVATION, economyOf, activationOf, entriesForItem, collect, spellGroups, quantityOf, rangeOf,
  describeActor, speedOf, stats, drawerData, roll, BASIC_ACTIONS, MOUNT_BASIC, postBasicAction, tooltipData
} from "./dnd5e.js";
import { getMountOf } from "./mount.js";
import { Movement } from "./movement.js";
import { getTheme } from "./themes.js";

const SUPPORTED = ["character", "npc"];

export class CombatHud {
  constructor() {
    this.token = null;
    this.enabled = false;
    this.minimized = false;
    this.drawerOpen = false;
    this.drawerTarget = "rider";
    this.flyout = null; // { panel, cat }
    this.used = new Map(); // actorUuid -> Set
    this.registry = new Map();
    this.root = null;
    this.tip = null;
    this._renderTimer = null;
    this._tipTimer = null;
    this._hoverKey = null;
    this._ring = null;
  }

  /* -------------------------------------------- */
  /*  Zustand                                     */
  /* -------------------------------------------- */

  get actor() {
    return this.token?.actor ?? null;
  }

  get mountDoc() {
    return this.token ? getMountOf(this.token.document) : null;
  }

  get mountActor() {
    return this.mountDoc?.actor ?? null;
  }

  get rendered() {
    return !!this.root?.isConnected;
  }

  /** Gehört dieses Dokument zum aktuell angezeigten Reiter oder Reittier? */
  concerns(actor) {
    if (!actor || !this.rendered) return false;
    return actor === this.actor || actor === this.mountActor;
  }

  usedSet() {
    const key = this.actor?.uuid;
    if (!key) return new Set();
    if (!this.used.has(key)) this.used.set(key, new Set());
    return this.used.get(key);
  }

  /* -------------------------------------------- */
  /*  Öffnen / Schließen                          */
  /* -------------------------------------------- */

  toggle(force) {
    const on = force ?? !this.enabled;
    this.enabled = on;
    if (!on) return this.bind(null);
    const target = canvas.tokens?.controlled?.[0] ?? game.user.character?.getActiveTokens?.()[0] ?? null;
    if (!target) {
      ui.notifications.info(t("Warn.SelectToken"));
      this.enabled = false;
      this.updateControlButton();
      return;
    }
    return this.bind(target);
  }

  bind(token) {
    const tk = token?.object ?? token;
    if (!tk || !tk.actor || !tk.actor.isOwner || !SUPPORTED.includes(tk.actor.type)) {
      this.token = null;
      this.close();
      return;
    }
    if (this.token !== tk) {
      this.flyout = null;
      this.drawerTarget = "rider";
    }
    this.token = tk;
    this.render(true);
  }

  close() {
    this.hideTip();
    this.clearRing();
    this.root?.remove();
    this.root = null;
    document.body.classList.remove("ach-open", "ach-hide-ui");
    this.updateControlButton();
  }

  updateControlButton() {
    const btn = document.querySelector(`[data-tool="ach-toggle"]`);
    btn?.classList.toggle("active", this.enabled);
    btn?.setAttribute?.("aria-pressed", String(this.enabled));
  }

  /* -------------------------------------------- */
  /*  Rendern                                     */
  /* -------------------------------------------- */

  render(now = false) {
    if (!this.token) return;
    if (now) return this._render();
    clearTimeout(this._renderTimer);
    this._renderTimer = setTimeout(() => this._render(), 40);
  }

  _render() {
    clearTimeout(this._renderTimer);
    const actor = this.actor;
    if (!actor || !this.token?.scene || this.token.destroyed) return this.close();
    this.registry.clear();

    if (!this.root) {
      this.root = document.createElement("div");
      this.root.id = "ach-hud";
      this.root.lang = game.i18n.lang ?? "de";
      this._attachListeners(this.root);
      document.body.appendChild(this.root);
    }
    const theme = getTheme(setting("theme"));
    const flip = !!setting("portraitRight");
    this.root.className = `ach-hud ach-theme-${theme.id}${this.minimized ? " ach-min" : ""}${this.mountDoc ? " ach-mounted" : ""}${flip ? " ach-flip" : ""}${setting("freePosition") ? " ach-free" : ""}`;

    this.root.innerHTML = `
      <div class="ach-body">
        ${this._portraitHTML()}
        <section class="ach-utilcol">
          ${this._utilHTML()}
          ${this._movementHTML()}
        </section>
        <div class="ach-panels">${this._panelsHTML()}</div>
        ${this._sideHTML()}
      </div>
      ${setting("freePosition") ? `<div class="ach-grip" data-tip="${esc(t("Hud.Drag"))}"><i class="fas fa-up-down-left-right"></i></div>` : ""}
      <button type="button" class="ach-minbtn" data-action="minimize" data-tip="${esc(t(this.minimized ? "Hud.Expand" : "Hud.Minimize"))}">
        <i class="fas ${this.minimized ? "fa-chevron-up" : "fa-chevron-down"}"></i>
      </button>`;

    document.body.classList.add("ach-open");
    document.body.classList.toggle("ach-hide-ui", !!setting("hideFoundryUi"));
    this.applyLayout();
    this.updateControlButton();
    this._positionFlyout();
    this._armFade();
  }

  /** Position und Größe anwenden (fest, gespiegelt oder frei verschoben). */
  applyLayout() {
    const root = this.root;
    if (!root) return;
    const flip = !!setting("portraitRight");
    const free = !!setting("freePosition");
    const offset = Number(setting("left")) || 0;
    const bottom = Number(setting("bottom")) || 0;
    const sidebar = document.getElementById("sidebar");
    const sidebarW = flip && sidebar ? sidebar.getBoundingClientRect().width : 0;

    // Größe
    let scale = Number(setting("scale")) || 1;
    if (setting("autoScale")) {
      scale *= Math.min(1.4, Math.max(0.55, window.innerWidth / 1920));
      const body = root.querySelector(".ach-body");
      const natural = (body?.offsetWidth ?? 0) + 40;
      const avail = window.innerWidth - (free ? 20 : offset + sidebarW + 20);
      if (natural * scale > avail && natural > 0) scale = Math.max(0.4, avail / natural);
    }
    this._scale = scale;
    root.style.setProperty("--ach-scale", scale);
    root.style.setProperty("--ach-fade-opacity", setting("fadeoutOpacity") ?? 0.35);

    root.style.left = root.style.right = root.style.top = "";
    if (free) {
      const pos = setting("freePos") ?? {};
      root.style.transformOrigin = "bottom left";
      root.style.left = `${Number(pos.left ?? offset)}px`;
      root.style.bottom = `${Number(pos.bottom ?? bottom)}px`;
    } else if (flip) {
      root.style.transformOrigin = "bottom right";
      root.style.right = `${offset + sidebarW}px`;
      root.style.bottom = `${bottom}px`;
    } else {
      root.style.transformOrigin = "bottom left";
      root.style.left = `${offset}px`;
      root.style.bottom = `${bottom}px`;
    }
  }

  /* --- Ausblenden, wenn die Maus nicht drüber ist --- */
  _armFade() {
    clearTimeout(this._fadeTimer);
    if (!setting("fadeOutInactive") || !this.root) return this.root?.classList.remove("ach-faded");
    if (this.root.matches(":hover")) return;
    this._fadeTimer = setTimeout(() => this.root?.classList.add("ach-faded"), (Number(setting("fadeoutDelay")) || 5) * 1000);
  }

  /* --- Frei verschieben --- */
  _startDrag(ev) {
    ev.preventDefault();
    const root = this.root;
    const rect = root.getBoundingClientRect();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const startLeft = rect.left;
    const startBottom = window.innerHeight - rect.bottom;
    root.style.transformOrigin = "bottom left";
    root.style.right = "";
    const move = (e) => {
      const left = Math.max(0, Math.min(window.innerWidth - 60, startLeft + e.clientX - startX));
      const bottom = Math.max(0, Math.min(window.innerHeight - 60, startBottom - (e.clientY - startY)));
      root.style.left = `${left}px`;
      root.style.bottom = `${bottom}px`;
      this._dragPos = { left: Math.round(left), bottom: Math.round(bottom) };
    };
    const up = async () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (this._dragPos) await game.settings.set(ID, "freePos", this._dragPos);
      this._dragPos = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  reg(obj) {
    const key = `k${this.registry.size + 1}`;
    this.registry.set(key, obj);
    return key;
  }

  /* -------------------------------------------- */
  /*  Portrait + Schublade                        */
  /* -------------------------------------------- */

  _portraitHTML() {
    const actor = this.actor;
    const s = stats(actor);
    const mount = this.mountDoc;
    const mActor = mount?.actor;
    const img = actor.img || this.token.document.texture?.src;
    const dying = actor.type === "character" && (actor.system.attributes?.hp?.value ?? 1) <= 0;

    const effectIcons = (a, cls = "") => conditionsOf(a)
      .map((e) => `<img class="ach-effect ${cls}" src="${esc(e.img)}" data-tip="${esc(e.name)}">`)
      .join("");
    const effects = effectIcons(actor);

    const hpChip = (st) => `
      <div class="ach-chip ach-chip-hp" data-tip="${esc(t("Portrait.HPTip"))}">
        <span class="ach-hp-bar" style="--pct:${st.hpPct}"></span>
        <b class="${st.hpTemp ? "ach-temp" : ""}">${st.hp}</b><span class="ach-sep">/</span><b class="${st.hpTempMax > 0 ? "ach-up" : st.hpTempMax < 0 ? "ach-down" : ""}">${st.hpMax}</b>
        <small>${esc(t("Portrait.HP"))}</small>
      </div>`;

    const riderStats = `
      <div class="ach-stats">
        ${hpChip(s)}
        <div class="ach-chip"><small>${esc(t("Portrait.AC"))}</small><b class="ach-hl">${s.ac}</b></div>
        ${s.dc && s.hasSpells ? `<div class="ach-chip"><small>${esc(t("Portrait.DC"))}</small><b class="ach-hl">${s.dc}</b></div>` : ""}
      </div>`;

    let mountBlock = "";
    if (mActor) {
      const ms = stats(mActor);
      mountBlock = `
        <div class="ach-who ach-who-mount" data-action="sheet" data-target="mount" data-tip="${esc(t("Mount.OpenSheet"))}">
          <div class="ach-desc"><i class="fas fa-horse-head"></i> ${esc(t("Mount.Label"))} · ${esc(describeActor(mActor))}</div>
          <div class="ach-name">${esc(mount.name || mActor.name)}</div>
          <div class="ach-effects-mount">${effectIcons(mActor, "small")}</div>
        </div>
        <div class="ach-stats ach-stats-mount">
          ${hpChip(ms)}
          <div class="ach-chip"><small>${esc(t("Portrait.AC"))}</small><b class="ach-hl">${ms.ac}</b></div>
          <div class="ach-chip" data-tip="${esc(t("Portrait.SpeedTip"))}"><i class="fas fa-horse"></i><b class="ach-hl">${ms.speed}</b></div>
        </div>`;
    }

    let death = "";
    if (dying) {
      const pip = (n, cls) => Array.from({ length: 3 }, (_, i) => `<i class="fas ${cls} ${i < n ? "on" : ""}"></i>`).join("");
      death = `
        <div class="ach-death">
          <div class="ach-death-row ach-death-ok">${pip(s.death.success, "fa-heart")}</div>
          <button type="button" class="ach-death-btn" data-action="death" data-tip="${esc(t("Portrait.DeathSave"))}"><i class="fas fa-skull"></i></button>
          <div class="ach-death-row ach-death-fail">${pip(s.death.failure, "fa-skull-crossbones")}</div>
        </div>`;
    }

    return `
      <section class="ach-portrait-col">
        ${this._drawerHTML()}
        ${setting("showResources") ? this._resourcesHTML() : ""}
        ${this._setsHTML()}
        <div class="ach-portrait ${mActor ? "is-mounted" : ""} ${dying ? "is-dying" : ""}">
          <div class="ach-portrait-img" style="background-image:url('${esc(img)}')" data-action="sheet" data-target="rider"></div>
          <div class="ach-effects">${effects}</div>
          ${death}
          <div class="ach-portrait-info">
            <div class="ach-who">
              <div class="ach-desc">${esc(describeActor(actor))}</div>
              <div class="ach-name">${esc(this.token.document.name || actor.name)}</div>
            </div>
            ${riderStats}
            ${mountBlock}
          </div>
          <span class="ach-corner tl"></span><span class="ach-corner tr"></span><span class="ach-corner bl"></span><span class="ach-corner br"></span>
        </div>
      </section>`;
  }

  _drawerHTML() {
    const head = `
      <div class="ach-drawer-head" data-action="drawer">
        <span>${esc(t("Drawer.Title"))}</span>
        <i class="fas ${this.drawerOpen ? "fa-chevron-down" : "fa-chevron-up"}"></i>
      </div>`;
    if (!this.drawerOpen) return head;
    const mActor = this.mountActor;
    const who = this.drawerTarget === "mount" && mActor ? mActor : this.actor;
    const d = drawerData(who);
    const tabs = mActor
      ? `<div class="ach-drawer-tabs">
          <button type="button" class="${who === this.actor ? "active" : ""}" data-action="drawer-tab" data-target="rider">${esc(this.actor.name)}</button>
          <button type="button" class="${who === mActor ? "active" : ""}" data-action="drawer-tab" data-target="mount"><i class="fas fa-horse-head"></i> ${esc(mActor.name)}</button>
        </div>`
      : "";
    const rk = (kind, key) => this.reg({ type: "roll", actor: who, kind, key });
    const abil = d.abilities.map((a) => `
      <div class="ach-row">
        <span class="ach-cell-label">${esc(a.label)}</span>
        <button type="button" class="ach-roll" data-key="${rk("check", a.key)}" data-tip="${esc(t("Drawer.Check"))}">${a.check}</button>
        <button type="button" class="ach-roll" data-key="${rk("save", a.key)}" data-tip="${esc(t("Drawer.Save"))}"><i class="${a.saveProf}"></i>${a.save}</button>
      </div>`).join("");
    const skills = d.skills.map((s) => `
      <button type="button" class="ach-row ach-row-btn" data-key="${rk("skill", s.key)}">
        <i class="${s.prof}"></i><span class="ach-cell-label">${esc(s.label)}</span><b>${s.total}</b><small>(${s.passive})</small>
      </button>`).join("");
    const tools = d.tools.length
      ? d.tools.map((tl) => `
        <button type="button" class="ach-row ach-row-btn" data-key="${rk("tool", tl.key)}">
          <i class="${tl.prof}"></i><span class="ach-cell-label">${esc(tl.label)}</span><b>${tl.total}</b>
        </button>`).join("")
      : `<div class="ach-empty">–</div>`;
    return `
      <div class="ach-drawer">
        ${tabs}
        <div class="ach-drawer-cols">
          <div class="ach-drawer-col">
            <div class="ach-col-head"><span>${esc(t("Drawer.Abilities"))}</span><span>${esc(t("Drawer.Check"))}</span><span>${esc(t("Drawer.Save"))}</span></div>
            ${abil}
            <div class="ach-col-head ach-col-head-tools"><span>${esc(t("Drawer.Tools"))}</span></div>
            ${tools}
          </div>
          <div class="ach-drawer-col ach-drawer-skills">
            <div class="ach-col-head"><span>${esc(t("Drawer.Skills"))}</span><span>${esc(t("Drawer.Passive"))}</span></div>
            ${skills}
          </div>
        </div>
      </div>
      ${head}`;
  }

  /* -------------------------------------------- */
  /*  Bewegung                                    */
  /* -------------------------------------------- */

  _movementHTML() {
    const actor = this.actor;
    const mode = this.token.document.movementAction ?? "walk";
    const speed = speedOf(actor, mode);
    const grid = canvas.scene?.grid?.distance || 5;
    const dashes = Movement.dashes(this.token.id);
    const total = speed * (1 + dashes);
    const spent = Movement.spent(this.token.id);
    const left = Math.max(0, total - spent);
    const baseSq = Math.max(0, Math.round(speed / grid));
    const totalSq = Math.max(0, Math.round(total / grid));
    const leftSq = Math.max(0, Math.floor(left / grid + 1e-6));
    const over = Math.max(0, spent - total);
    const inCombat = !!game.combat?.started;

    let cells = "";
    if (totalSq <= 36) {
      for (let i = totalSq - 1; i >= 0; i--) {
        const isDash = i >= baseSq;
        const spentCell = i >= leftSq;
        cells += `<span class="ach-sq ${isDash ? "dash" : ""} ${spentCell ? "spent" : ""}"></span>`;
      }
    } else {
      cells = `<span class="ach-movebar" style="--pct:${total ? left / total : 0}"></span>`;
    }
    const icon = { fly: "fa-dove", swim: "fa-water", climb: "fa-mountain", burrow: "fa-worm" }[mode] ?? (this.mountDoc ? "fa-horse" : "fa-person-walking");
    return `
      <section class="ach-movement ${over ? "over" : ""}" data-tip="${esc(t("Move.Tip", { left: Math.round(left), total, units: canvas.scene?.grid?.units ?? "ft" }))}">
        <div class="ach-move-cells ${totalSq > 10 ? "two-col" : ""}">${cells}</div>
        <div class="ach-move-num"><b>${inCombat ? leftSq : totalSq}</b><i class="fas ${icon}"></i></div>
        <div class="ach-move-total">${Math.round(inCombat ? left : total)}</div>
      </section>`;
  }

  /* -------------------------------------------- */
  /*  Aktionsbereiche                             */
  /* -------------------------------------------- */

  _panelsHTML() {
    const panels = this._buildPanels();
    return panels.map((p) => this._panelHTML(p)).join("");
  }

  _buildPanels() {
    const panels = this._buildPanelsRaw();
    for (const p of panels) p.tiles = p.tiles.filter(Boolean);
    return panels.filter((p) => p.tiles.length || p.id === "action" || p.id === "mount" || setting("showEmptyPanels"))
      .filter((p) => p.id !== "mount" || setting("mountPanel"));
  }

  _buildPanelsRaw() {
    const actor = this.actor;
    const sets = getWeaponSets(actor);
    const active = sets.sets[sets.active] ?? {};
    const primary = actor.items.get(active.primary ?? "") ?? null;
    const secondary = actor.items.get(active.secondary ?? "") ?? null;
    const setItems = [primary, secondary].filter(Boolean);
    const panels = [];

    // --- Aktion ---
    {
      const c = collect(actor, ACTIVATION.action, { exclude: setItems });
      const tiles = [];
      tiles.push(this._setSlotTile(primary, "primary", "action"));
      if (c.weapons.length) tiles.push(this._catTile("weapons", t("Cat.Weapons"), "fas fa-khanda", [{ entries: c.weapons }], { actor }));
      if (c.spells.length) tiles.push(this._spellCat(actor, c.spells));
      tiles.push(...this._barTiles(actor, c.barFeatures));
      if (c.features.length) tiles.push(this._catTile("features", t("Cat.Features"), "fas fa-hand-fist", [{ entries: c.features }], { actor }));
      if (c.items.length) tiles.push(this._catTile("items", t("Cat.Items"), "fas fa-flask", [{ entries: c.items }], { actor }));
      if (setting("showBasicActions")) tiles.push(this._basicCat(actor, BASIC_ACTIONS.map((a) => a.id), null));
      panels.push({ id: "action", label: t("Panel.Action"), tiles });
    }

    // --- Bonusaktion ---
    {
      const c = collect(actor, ACTIVATION.bonus);
      const tiles = [];
      const off = secondary ? entriesForItem(secondary, ["action", "bonus"])[0] : null;
      if (off) tiles.push(this._entryTile({ ...off, label: secondary.name }, actor, { economy: "bonus", slot: "secondary" }));
      if (c.weapons.length) tiles.push(this._catTile("weapons", t("Cat.Weapons"), "fas fa-khanda", [{ entries: c.weapons }], { actor }));
      if (c.spells.length) tiles.push(this._spellCat(actor, c.spells));
      tiles.push(...this._barTiles(actor, c.barFeatures));
      if (c.features.length) tiles.push(this._catTile("features", t("Cat.Features"), "fas fa-hand-fist", [{ entries: c.features }], { actor }));
      if (c.items.length) tiles.push(this._catTile("items", t("Cat.Items"), "fas fa-flask", [{ entries: c.items }], { actor }));
      panels.push({ id: "bonus", label: t("Panel.Bonus"), tiles });
    }

    // --- Reittier ---
    const mActor = this.mountActor;
    if (mActor) {
      const types = [...ACTIVATION.action, ...ACTIVATION.bonus, ...ACTIVATION.special];
      const c = collect(mActor, types);
      const opts = { actor: mActor, mount: true };
      const tiles = [];
      const attacks = c.weapons;
      if (attacks.length <= 2) attacks.forEach((e) => tiles.push(this._entryTile(e, mActor, { mount: true })));
      else {
        tiles.push(this._entryTile(attacks[0], mActor, { mount: true }));
        tiles.push(this._catTile("m-attacks", t("Cat.MountAttacks"), "fas fa-paw", [{ entries: attacks.slice(1) }], opts));
      }
      tiles.push(...this._barTiles(mActor, c.barFeatures, { mount: true }));
      const feats = [...c.features, ...c.items];
      if (feats.length) tiles.push(this._catTile("m-features", t("Cat.MountFeatures"), "fas fa-horse-head", [{ entries: feats }], opts));
      if (c.spells.length) tiles.push(this._spellCat(mActor, c.spells, { mount: true }));
      tiles.push(this._basicCat(mActor, MOUNT_BASIC, actor));
      if (game.modules.get("ascandir-mounting")?.api?.dismount) tiles.push({ kind: "dismount", key: this.reg({ type: "dismount" }) });
      panels.push({ id: "mount", label: t("Panel.Mount"), tiles, mount: true, locked: !mActor.isOwner, sub: mActor.name });
    }

    // --- Reaktion ---
    {
      const c = collect(actor, ACTIVATION.reaction);
      const tiles = [];
      if (primary && isMelee(primary)) {
        const e = entriesForItem(primary, ["action"])[0];
        if (e) tiles.push(this._entryTile({ ...e, label: primary.name }, actor, { economy: "reaction", tip: t("Hud.OpportunityAttack") }));
      }
      if (c.weapons.length) tiles.push(this._catTile("weapons", t("Cat.Weapons"), "fas fa-khanda", [{ entries: c.weapons }], { actor }));
      if (c.spells.length) tiles.push(this._spellCat(actor, c.spells));
      tiles.push(...this._barTiles(actor, c.barFeatures));
      if (c.features.length) tiles.push(this._catTile("features", t("Cat.Features"), "fas fa-hand-fist", [{ entries: c.features }], { actor }));
      if (c.items.length) tiles.push(this._catTile("items", t("Cat.Items"), "fas fa-flask", [{ entries: c.items }], { actor }));
      panels.push({ id: "reaction", label: t("Panel.Reaction"), tiles });
    }

    // --- Spezial ---
    {
      const c = collect(actor, ACTIVATION.special);
      const tiles = [];
      tiles.push(...this._barTiles(actor, c.barFeatures));
      if (c.weapons.length) tiles.push(this._catTile("weapons", t("Cat.Weapons"), "fas fa-khanda", [{ entries: c.weapons }], { actor }));
      if (c.spells.length) tiles.push(this._spellCat(actor, c.spells));
      if (c.features.length) tiles.push(this._catTile("features", t("Cat.Features"), "fas fa-hand-fist", [{ entries: c.features }], { actor }));
      if (c.items.length) tiles.push(this._catTile("items", t("Cat.Items"), "fas fa-flask", [{ entries: c.items }], { actor }));
      panels.push({ id: "special", label: t("Panel.Special"), tiles });
    }

    // --- Legendär / Hort / Mythisch (NSC) ---
    for (const id of ["legendary", "lair", "mythic"]) {
      const c = collect(actor, ACTIVATION[id]);
      const all = [...c.weapons, ...c.spells, ...c.barFeatures, ...c.features, ...c.items];
      if (!all.length) continue;
      const tiles = all.length <= 3 ? all.map((e) => this._entryTile(e, actor)) : [this._catTile(id, t(`Panel.${cap(id)}`), "fas fa-crown", [{ entries: all }], { actor })];
      let pips = null;
      if (id === "legendary") {
        const r = actor.system.resources?.legact;
        if (r?.max) pips = { value: r.value ?? 0, max: r.max };
      }
      panels.push({ id, label: t(`Panel.${cap(id)}`), tiles, pips });
    }
    // --- Makros (wie die Makroleiste) ---
    if (setting("macroPanel")) {
      const macros = (game.user.getHotbarMacros?.(1) ?? []).filter((m) => m.macro);
      if (macros.length) {
        const tiles = macros.map(({ macro }) => ({ kind: "macro", macro, key: this.reg({ type: "macro", macro }) }));
        panels.push({ id: "macros", label: t("Panel.Macros"), tiles });
      }
    }
    return panels;
  }

  _panelHTML(p) {
    const used = this.usedSet().has(p.id);
    this._curPanel = p.id;
    const tilesHTML = p.tiles.map((tile) => this._tileHTML(tile)).join("") || `<div class="ach-tile ach-tile-empty"></div>`;
    const flyout = this.flyout?.panel === p.id ? this._flyoutHTML(p) : "";
    const pips = p.pips ? `<span class="ach-pips">${pipsHTML(p.pips.value, p.pips.max)}</span>` : "";
    const sub = p.sub ? `<small class="ach-panel-sub">${esc(p.sub)}</small>` : "";
    return `
      <div class="ach-panel ach-panel-${p.id} ${used ? "is-used" : ""} ${p.locked ? "is-locked" : ""}" data-panel="${p.id}">
        <div class="ach-panel-tiles">${tilesHTML}</div>
        <div class="ach-panel-label" data-action="toggle-used" data-panel="${p.id}" data-tip="${esc(t(p.locked ? "Mount.NotOwner" : "Hud.ToggleUsed"))}">
          ${p.mount ? `<i class="fas fa-horse-head"></i>` : ""}<span>${esc(p.label)}</span>${pips}${sub}
          ${p.locked ? `<i class="fas fa-lock"></i>` : ""}
        </div>
        ${flyout}
      </div>`;
  }

  /* --- Kacheln --- */

  _entryTile(entry, actor, { economy = null, mount = false, slot = null, tip = null } = {}) {
    return { kind: "entry", key: this.reg({ type: "entry", entry, actor, economy, mount, slot, tip }), entry, actor, mount };
  }

  _setSlotTile(item, slot, panel) {
    const actor = this.actor;
    if (item) {
      const e = entriesForItem(item, ACTIVATION.action)[0] ?? entriesForItem(item, ["bonus", "reaction", "special"])[0];
      if (e) return this._entryTile({ ...e, label: item.name }, actor, { economy: panel, slot });
    }
    return { kind: "slot", key: this.reg({ type: "slot", slot }), slot };
  }

  _barTiles(actor, entries, { mount = false } = {}) {
    if (!entries.length) return [];
    if (!setting("condenseFeatures")) return entries.map((e) => this._entryTile(e, actor, { mount }));
    const tiles = [];
    for (let i = 0; i < entries.length; i += 2) {
      const a = this._entryTile(entries[i], actor, { mount });
      const b = entries[i + 1] ? this._entryTile(entries[i + 1], actor, { mount }) : null;
      tiles.push(b ? { kind: "split", a, b } : a);
    }
    return tiles;
  }

  _catTile(id, label, icon, groups, { actor, mount = false } = {}) {
    const key = this.reg({ type: "cat", id, label, groups, actor, mount });
    return { kind: "cat", key, id, label, icon };
  }

  _spellCat(actor, entries, { mount = false } = {}) {
    const groups = spellGroups(actor, entries);
    if (!groups.length) return null;
    return this._catTile(mount ? "m-spells" : "spells", t("Cat.Spells"), "fas fa-book-open", groups, { actor, mount });
  }

  _basicCat(actor, ids, mountOf) {
    const actions = BASIC_ACTIONS.filter((a) => ids.includes(a.id));
    const key = this.reg({ type: "cat", id: mountOf ? "m-basic" : "basic", label: t(mountOf ? "Cat.MountBasic" : "Cat.Basic"), basic: actions, actor, mount: !!mountOf, mountOf });
    return { kind: "cat", key, id: mountOf ? "m-basic" : "basic", label: t(mountOf ? "Cat.MountBasic" : "Cat.Basic"), icon: mountOf ? "fas fa-horse" : "fas fa-person-running" };
  }

  _tileHTML(tile, { small = false } = {}) {
    if (!tile) return "";
    switch (tile.kind) {
      case "split":
        return `<div class="ach-split">${this._tileHTML(tile.a, { half: true })}${this._tileHTML(tile.b, { half: true })}</div>`;
      case "slot":
        return `
          <div class="ach-tile ach-tile-slot" data-key="${tile.key}" data-drop="${tile.slot}" data-tip="${esc(t("Sets.EmptySlot"))}">
            <i class="fas fa-hand-fist"></i><span class="ach-tile-label">${esc(t("Sets.Empty"))}</span>
          </div>`;
      case "cat": {
        const open = this.flyout && this.flyout.panel === this._curPanel && this.flyout.cat === tile.id ? "is-open" : "";
        return `
          <div class="ach-tile ach-tile-cat ${open}" data-key="${tile.key}" data-cat="${tile.id}">
            <i class="${tile.icon}"></i><span class="ach-tile-label">${esc(tile.label)}</span>
          </div>`;
      }
      case "entry": {
        const e = tile.entry;
        const qty = quantityOf(e);
        const img = e.activity?.img && !String(e.activity.img).includes("svg/") ? e.activity.img : e.item.img;
        const empty = qty === 0 ? "is-empty" : "";
        return `
          <div class="ach-tile ach-tile-item ${small ? "small" : ""} ${empty}" data-key="${tile.key}" style="background-image:url('${esc(img)}')">
            ${qty != null ? `<span class="ach-qty">${qty}</span>` : ""}
            <span class="ach-tile-label">${esc(e.label ?? e.item.name)}</span>
          </div>`;
      }
      case "dismount":
        return `
          <div class="ach-tile ach-tile-cat ach-dismount" data-key="${tile.key}" data-tip="${esc(t("Mount.DismountTip"))}">
            <i class="fas fa-person-falling"></i><span class="ach-tile-label">${esc(t("Mount.Dismount"))}</span>
          </div>`;
      case "macro":
        return `
          <div class="ach-tile ach-tile-item ach-tile-macro" data-key="${tile.key}" data-tip="${esc(tile.macro.name)}" style="background-image:url('${esc(tile.macro.img)}')">
            <span class="ach-tile-label">${esc(tile.macro.name)}</span>
          </div>`;
      case "basic": {
        const a = tile.action;
        return `
          <div class="ach-tile ach-tile-basic small" data-key="${tile.key}">
            <i class="${a.icon}"></i><span class="ach-tile-label">${esc(t(`Basic.${a.id}.Name`))}</span>
          </div>`;
      }
    }
    return "";
  }

  _flyoutHTML(panel) {
    // Passende Kategorie in der Registry suchen
    let cat = null;
    for (const [key, obj] of this.registry) {
      if (obj.type === "cat" && obj.id === this.flyout.cat && this._panelOfKey(key, panel)) {
        cat = obj;
        break;
      }
    }
    if (!cat) return "";
    let body = "";
    if (cat.basic) {
      const tiles = cat.basic.map((action) => ({ kind: "basic", action, key: this.reg({ type: "basic", action, actor: cat.actor, mount: cat.mount, mountOf: cat.mountOf }) }));
      body = `<div class="ach-group"><div class="ach-group-grid">${tiles.map((x) => this._tileHTML(x)).join("")}</div></div>`;
    } else {
      body = cat.groups.map((g) => {
        const tiles = g.entries.map((e) => this._entryTile(e, cat.actor, { mount: cat.mount }));
        const head = g.label || g.slots
          ? `<div class="ach-group-head"><span>${esc(g.label ?? "")}</span>${g.slots && g.slots.max ? `<span class="ach-pips">${pipsHTML(g.slots.value, g.slots.max)}</span>` : ""}</div>`
          : "";
        return `<div class="ach-group">${head}<div class="ach-group-grid">${tiles.map((x) => this._tileHTML(x, { small: true })).join("")}</div></div>`;
      }).join("");
    }
    return `
      <div class="ach-flyout ${cat.mount ? "is-mount" : ""}" data-flyout="${panel.id}">
        <div class="ach-flyout-head"><span>${esc(cat.label)}</span><button type="button" data-action="close-flyout"><i class="fas fa-xmark"></i></button></div>
        <div class="ach-flyout-body">${body}</div>
      </div>`;
  }

  _panelOfKey(key, panel) {
    return panel.tiles.some((tile) => tile?.key === key || tile?.a?.key === key || tile?.b?.key === key);
  }

  _positionFlyout() {
    const fly = this.root?.querySelector(".ach-flyout");
    if (!fly) return;
    const panel = fly.closest(".ach-panel");
    const cat = panel?.querySelector(".ach-tile-cat.is-open");
    if (!cat) return;
    const offset = cat.offsetLeft;
    fly.style.left = `${Math.max(0, offset - 8)}px`;
    // Nicht über den rechten Bildschirmrand hinaus
    requestAnimationFrame(() => {
      const r = fly.getBoundingClientRect();
      const over = r.right - window.innerWidth + 8;
      const sc = this._scale || 1;
      if (over > 0) fly.style.left = `${offset - 8 - over / sc}px`;
      const r2 = fly.getBoundingClientRect();
      if (r2.left < 8) fly.style.left = `${parseFloat(fly.style.left) + (8 - r2.left) / sc}px`;
    });
  }

  /* -------------------------------------------- */
  /*  Seitenleiste: Waffensets, Zug beenden, Rast */
  /* -------------------------------------------- */

  _setsHTML() {
    const actor = this.actor;
    const sets = getWeaponSets(actor);
    const html = ["1", "2", "3"].map((n) => {
      const s = sets.sets[n] ?? {};
      const slot = (which) => {
        const item = actor.items.get(s[which] ?? "");
        return `<div class="ach-set-slot ${which}" data-drop="${n}:${which}" ${item ? `style="background-image:url('${esc(item.img)}')" data-tip="${esc(item.name)}"` : `data-tip="${esc(t(which === "primary" ? "Sets.Primary" : "Sets.Secondary"))}"`}></div>`;
      };
      return `
        <div class="ach-set ${sets.active === n ? "active" : ""}" data-action="set" data-set="${n}">
          <span class="ach-set-num">${["I", "II", "III"][Number(n) - 1]}</span>${slot("primary")}${slot("secondary")}
        </div>`;
    }).join("");
    return `<div class="ach-sets">${html}</div>`;
  }

  _resourcesHTML() {
    const { slots, res } = resourcesData(this.actor);
    if (!slots.length && !res.length) return "";
    const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
    const gems = (value, max, cls) => {
      if (max > 10) return `<span class="ach-res-count">${value}/${max}</span>`;
      return Array.from({ length: max }, (_, i) => `<i class="ach-gem ${cls} ${i < value ? "on" : ""}"></i>`).join("");
    };
    const icons = (value, max, kind) => {
      if (max > 10) return `<i class="${RESOURCE_ICONS[kind]} ach-res-ico on ${kind}"></i><span class="ach-res-count">${value}/${max}</span>`;
      return Array.from({ length: max }, (_, i) => `<i class="${RESOURCE_ICONS[kind]} ach-res-ico ${kind} ${i < value ? "on" : ""}"></i>`).join("");
    };
    const slotHTML = slots.length
      ? `<div class="ach-res-slots">${slots.map((s) => `
          <span class="ach-res-slot" data-tip="${esc(s.kind === "pact" ? t("Res.Pact", { level: s.level, value: s.value, max: s.max }) : t("Res.Slot", { level: s.level, value: s.value, max: s.max }))}">
            <b>${s.kind === "pact" ? `<i class="fas fa-eye"></i>${ROMAN[s.level] ?? ""}` : ROMAN[s.level]}</b>${gems(s.value, s.max, s.kind)}
          </span>`).join("")}</div>`
      : "";
    const resHTML = res.map((r) => `
      <div class="ach-res-row" data-tip="${esc(`${r.name}: ${r.value}/${r.max}`)}">
        <span class="ach-res-name">${esc(r.name)}</span>
        <span class="ach-res-pips">${r.kind === "generic" ? gems(r.value, r.max, "bead") : icons(r.value, r.max, r.kind)}</span>
      </div>`).join("");
    return `<div class="ach-resources">${slotHTML}${resHTML}</div>`;
  }

  _utilHTML() {
    const c = game.combat;
    const combatant = c?.combatants?.find?.((cb) => cb.tokenId === this.token.id) ?? null;
    const ini = combatant?.initiative;
    const btn = (action, icon, tip, extra = "") => `<button type="button" data-action="${action}" data-tip="${esc(tip)}">${extra || `<i class="${icon}"></i>`}</button>`;
    let html = btn("sheet-rider", "fas fa-scroll", t("Hud.Sheet"));
    html += btn("initiative", "fas fa-dice-d20", ini != null ? t("Hud.InitiativeValue", { value: ini }) : t("Hud.Initiative"),
      ini != null ? `<i class="fas fa-dice-d20"></i><b>${Math.round(ini)}</b>` : "");
    if (!c?.started) {
      html += btn("short-rest", "fas fa-mug-hot", loc("DND5E.REST.Short.Label") || t("Hud.ShortRest"));
      html += btn("long-rest", "fas fa-campground", loc("DND5E.REST.Long.Label") || t("Hud.LongRest"));
    }
    return `<div class="ach-util">${html}</div>`;
  }

  _sideHTML() {
    const c = game.combat;
    const myTurn = c?.started && c.combatant?.tokenId === this.token.id && (c.combatant?.isOwner || game.user.isGM);
    if (!myTurn) return "";
    return `
      <section class="ach-side">
        <div class="ach-panel ach-panel-endturn">
          <div class="ach-panel-tiles">
            <div class="ach-tile ach-tile-cat ach-endturn" data-action="end-turn" data-tip="${esc(t("Hud.EndTurn"))}">
              <i class="fas fa-hourglass-end"></i>
            </div>
          </div>
          <div class="ach-panel-label" data-action="end-turn"><span>${esc(t("Hud.EndTurn"))}</span></div>
        </div>
      </section>`;
  }

  /* -------------------------------------------- */
  /*  Ereignisse                                  */
  /* -------------------------------------------- */

  _attachListeners(root) {
    root.addEventListener("click", (ev) => this._onClick(ev));
    root.addEventListener("contextmenu", (ev) => this._onRightClick(ev));
    root.addEventListener("mouseover", (ev) => this._onHover(ev));
    root.addEventListener("mouseleave", () => {
      this.hideTip();
      this.clearRing();
      this._hoverKey = null;
      this._armFade();
    });
    root.addEventListener("mouseenter", () => {
      clearTimeout(this._fadeTimer);
      root.classList.remove("ach-faded");
    });
    root.addEventListener("pointerdown", (ev) => {
      if (ev.button === 0 && ev.target.closest(".ach-grip")) this._startDrag(ev);
    });
    root.addEventListener("dragover", (ev) => {
      if (ev.target.closest("[data-drop]")) {
        ev.preventDefault();
        ev.target.closest("[data-drop]").classList.add("drag-over");
      }
    });
    root.addEventListener("dragleave", (ev) => ev.target.closest?.("[data-drop]")?.classList.remove("drag-over"));
    root.addEventListener("drop", (ev) => this._onDrop(ev));
    document.addEventListener("pointerdown", (ev) => {
      if (!this.flyout || !this.root) return;
      if (this.root.contains(ev.target)) return;
      this.flyout = null;
      this.render();
    }, true);
  }

  async _onClick(ev) {
    const actionEl = ev.target.closest("[data-action]");
    const keyEl = ev.target.closest("[data-key]");
    if (keyEl) {
      const obj = this.registry.get(keyEl.dataset.key);
      if (obj) return this._onKey(obj, keyEl, ev);
    }
    if (!actionEl) return;
    const a = actionEl.dataset.action;
    switch (a) {
      case "minimize":
        this.minimized = !this.minimized;
        this.flyout = null;
        return this.render(true);
      case "drawer":
        this.drawerOpen = !this.drawerOpen;
        return this.render(true);
      case "drawer-tab":
        this.drawerTarget = actionEl.dataset.target;
        return this.render(true);
      case "sheet": {
        const who = actionEl.dataset.target === "mount" ? this.mountActor : this.actor;
        if (who?.testUserPermission?.(game.user, "OBSERVER")) who.sheet.render(true);
        return;
      }
      case "sheet-rider":
        return this.actor.sheet?.render(true);
      case "initiative":
        return this._rollInitiative(ev);
      case "death":
        return roll(this.actor, "death", null, ev);
      case "toggle-used": {
        if (!game.combat?.started) return;
        const set = this.usedSet();
        const p = actionEl.dataset.panel;
        set.has(p) ? set.delete(p) : set.add(p);
        return this.render(true);
      }
      case "close-flyout":
        this.flyout = null;
        return this.render(true);
      case "set":
        return this._switchSet(actionEl.dataset.set);
      case "end-turn":
        return game.combat?.nextTurn();
      case "short-rest":
        return this.actor.shortRest?.();
      case "long-rest":
        return this.actor.longRest?.();
    }
  }

  async _rollInitiative(ev) {
    const actor = this.actor;
    try {
      if (game.combat) {
        const cb = game.combat.combatants.find((c) => c.tokenId === this.token.id);
        if (cb && cb.initiative != null) return ui.notifications.info(t("Hud.InitiativeDone", { value: cb.initiative }));
      }
      if (actor.rollInitiativeDialog) return await actor.rollInitiativeDialog({ event: ev });
      return await actor.rollInitiative({ createCombatants: true });
    } catch (err) {
      console.error(`${ID} |`, err);
    }
  }

  async _onKey(obj, el, ev) {
    switch (obj.type) {
      case "roll":
        return roll(obj.actor, obj.kind, obj.key, ev);
      case "cat": {
        const panel = el.closest(".ach-panel")?.dataset.panel;
        const same = this.flyout?.panel === panel && this.flyout?.cat === obj.id;
        this.flyout = same ? null : { panel, cat: obj.id };
        this.hideTip();
        return this.render(true);
      }
      case "slot":
        return ui.notifications.info(t("Sets.EmptySlot"));
      case "entry":
        return this._useEntry(obj, ev);
      case "basic":
        return this._useBasic(obj);
      case "macro":
        return obj.macro?.execute?.();
      case "dismount":
        this.hideTip();
        try {
          await game.modules.get("ascandir-mounting")?.api?.dismount?.(this.token.document);
        } catch (err) {
          console.error(`${ID} |`, err);
        }
        return;
    }
  }

  async _useEntry(obj, ev) {
    const { entry, actor, mount } = obj;
    if (!actor.isOwner) return ui.notifications.warn(t(mount ? "Mount.NotOwner" : "Warn.NotOwner"));
    this.hideTip();
    let result;
    try {
      result = entry.activity && !entry.multi
        ? await entry.activity.use({ event: ev }, { event: ev })
        : await entry.item.use?.({ event: ev, legacy: false }, { event: ev });
    } catch (err) {
      console.error(`${ID} |`, err);
      return;
    }
    if (!result) return;
    const type = obj.economy ?? economyOf(activationOf(entry.activity));
    this.consume(actor, type, mount);
    if (this.flyout && !ev.shiftKey) this.flyout = null;
    this.render();
  }

  async _useBasic(obj) {
    const { action, actor, mount, mountOf } = obj;
    if (!actor.isOwner && !mountOf?.isOwner) return ui.notifications.warn(t("Warn.NotOwner"));
    if (action.dash) Movement.addDash(this.token.id);
    await postBasicAction(actor, action, { mountOf });
    this.consume(actor, action.economy, mount);
    this.flyout = null;
    this.render();
  }

  /** Markiert Aktion/Bonus/Reaktion/Reittier als verbraucht (nur im Kampf). */
  consume(actor, type, mount = false) {
    if (!game.combat?.started || !setting("trackEconomy")) return;
    const set = this.usedSet();
    if (mount) {
      set.add("mount");
      return;
    }
    if (!type) return;
    const myTurn = game.combat.combatant?.actor === actor || game.combat.combatant?.tokenId === this.token?.id;
    if (!myTurn && (type === "action" || type === "bonus")) type = "reaction";
    set.add(type);
  }

  resetEconomy(actor) {
    if (!actor) return this.used.clear();
    this.used.delete(actor.uuid);
  }

  _onRightClick(ev) {
    const drop = ev.target.closest("[data-drop]");
    if (drop && drop.dataset.drop.includes(":")) {
      ev.preventDefault();
      const [set, which] = drop.dataset.drop.split(":");
      return this._assignSlot(set, which, null);
    }
    const keyEl = ev.target.closest("[data-key]");
    const obj = keyEl && this.registry.get(keyEl.dataset.key);
    if (obj?.type === "entry") {
      ev.preventDefault();
      if (obj.slot && ev.shiftKey) {
        const active = getWeaponSets(this.actor).active;
        return this._assignSlot(active, obj.slot, null);
      }
      const doc = obj.entry.activity && obj.entry.activity.sheet ? obj.entry.activity : obj.entry.item;
      if (obj.entry.item?.testUserPermission?.(game.user, "OBSERVER")) (doc.sheet ?? obj.entry.item.sheet)?.render(true);
    }
  }

  async _onDrop(ev) {
    const target = ev.target.closest("[data-drop]");
    if (!target) return;
    ev.preventDefault();
    target.classList.remove("drag-over");
    let data;
    try {
      data = JSON.parse(ev.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }
    if (data?.type !== "Item") return;
    let item = null;
    try {
      item = data.uuid ? await fromUuid(data.uuid) : null;
    } catch { /* ignorieren */ }
    const own = item && (item.parent === this.actor ? item : this.actor.items.get(item.id));
    if (!own) return ui.notifications.warn(t("Sets.OwnItemsOnly"));
    let [set, which] = target.dataset.drop.split(":");
    if (!which) {
      which = set;
      set = getWeaponSets(this.actor).active;
    }
    return this._assignSlot(set, which, own.id);
  }

  async _assignSlot(set, which, itemId) {
    const actor = this.actor;
    const data = getWeaponSets(actor);
    data.sets[set] = { ...(data.sets[set] ?? {}), [which]: itemId };
    await actor.setFlag(ID, "weaponSets", { active: data.active, sets: data.sets });
    if (set === data.active) await this._equipSet(data, set);
    this.render();
  }

  async _switchSet(n) {
    const actor = this.actor;
    const data = getWeaponSets(actor);
    if (data.active === n) return;
    data.active = n;
    await actor.setFlag(ID, "weaponSets", { active: n, sets: data.sets });
    await this._equipSet(data, n);
    this.render();
  }

  async _equipSet(data, n) {
    if (!setting("switchEquip")) return;
    const actor = this.actor;
    const activeIds = new Set(Object.values(data.sets[n] ?? {}).filter(Boolean));
    const otherIds = new Set(Object.entries(data.sets).filter(([k]) => k !== n).flatMap(([, s]) => Object.values(s ?? {})).filter(Boolean));
    const updates = [];
    for (const id of activeIds) {
      const it = actor.items.get(id);
      if (it && it.system.equipped === false) updates.push({ _id: id, "system.equipped": true });
    }
    for (const id of otherIds) {
      if (activeIds.has(id)) continue;
      const it = actor.items.get(id);
      if (it?.system.equipped) updates.push({ _id: id, "system.equipped": false });
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  }

  /* -------------------------------------------- */
  /*  Tooltip + Reichweitenring                   */
  /* -------------------------------------------- */

  _onHover(ev) {
    const el = ev.target.closest("[data-key], [data-tip]");
    const id = el ? el.dataset.key ?? `tip:${el.dataset.tip}` : null;
    if (id === this._hoverKey) return;
    this._hoverKey = id;
    this.hideTip();
    this.clearRing();
    if (!el) return;
    const obj = el.dataset.key ? this.registry.get(el.dataset.key) : null;
    if (obj?.type === "entry" && setting("rangeRing")) this.drawRing(obj);
    if (!setting("showTooltips")) return;
    clearTimeout(this._tipTimer);
    this._tipTimer = setTimeout(() => this._showTip(el, obj), obj?.type === "entry" ? 350 : 250);
  }

  async _showTip(el, obj) {
    if (!el.isConnected) return;
    let html = "";
    let rich = false;
    if (obj?.type === "entry") {
      const data = await tooltipData(obj.entry);
      if (!data || !el.isConnected) return;
      rich = true;
      const owner = obj.mount ? `<div class="ach-tip-owner"><i class="fas fa-horse-head"></i> ${esc(obj.actor.name)}</div>` : "";
      const extra = obj.tip ? `<div class="ach-tip-note">${esc(obj.tip)}</div>` : "";
      const locked = obj.mount && !obj.actor.isOwner ? `<div class="ach-tip-note warn">${esc(t("Mount.NotOwner"))}</div>` : "";
      html = `
        <header class="ach-tip-head">
          <img src="${esc(data.img)}">
          <div><div class="ach-tip-title">${esc(data.title)}</div>${data.subtitle ? `<div class="ach-tip-sub">${esc(data.subtitle)}</div>` : ""}</div>
        </header>
        ${owner}${extra}${locked}
        ${data.description ? `<div class="ach-tip-desc">${data.description}</div>` : ""}
        ${data.details.length ? `<dl class="ach-tip-details">${data.details.map((d) => `<dt>${esc(d.label)}</dt><dd>${d.html ? d.value : esc(d.value)}</dd>`).join("")}</dl>` : ""}
        ${data.properties.length ? `<div class="ach-tip-props">${data.properties.map((p) => `<span class="${p.primary ? "primary" : ""}">${esc(p.label)}</span>`).join("")}</div>` : ""}
        <span class="ach-seal"></span>`;
    } else if (obj?.type === "basic") {
      rich = true;
      html = `
        <header class="ach-tip-head"><i class="${obj.action.icon} ach-tip-icon"></i><div><div class="ach-tip-title">${esc(t(`Basic.${obj.action.id}.Name`))}</div>${obj.mountOf ? `<div class="ach-tip-sub">${esc(t("Mount.ControlledBy", { rider: obj.mountOf.name }))}</div>` : ""}</div></header>
        <div class="ach-tip-desc"><p>${esc(t(`Basic.${obj.action.id}.Desc`))}</p></div>
        <span class="ach-seal"></span>`;
    } else if (obj?.type === "cat") {
      if (el.classList.contains("is-open")) return;
      html = esc(obj.label);
    } else if (el.dataset.tip) {
      html = esc(el.dataset.tip);
    } else return;

    if (!this.tip) {
      this.tip = document.createElement("div");
      this.tip.id = "ach-tooltip";
      document.body.appendChild(this.tip);
    }
    const theme = getTheme(setting("theme"));
    this.tip.className = `ach-tooltip ach-theme-${theme.id} ${rich ? "rich" : "plain"}`;
    this.tip.style.setProperty("--ach-tip-scale", Number(setting("tooltipScale")) || 1);
    this.tip.innerHTML = html;
    this.tip.style.visibility = "hidden";
    this.tip.style.display = "block";
    const r = el.getBoundingClientRect();
    const tr = this.tip.getBoundingClientRect();
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(8, Math.min(window.innerWidth - tr.width - 8, left));
    let top = r.top - tr.height - 10;
    if (top < 8) top = Math.min(window.innerHeight - tr.height - 8, r.bottom + 10);
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${Math.max(8, top)}px`;
    this.tip.style.visibility = "visible";
  }

  hideTip() {
    clearTimeout(this._tipTimer);
    if (this.tip) this.tip.style.display = "none";
  }

  drawRing(obj) {
    const token = this.token;
    if (!token?.center || !canvas?.ready) return;
    const range = rangeOf(obj.entry.activity);
    if (!range?.normal) return;
    const src = obj.mount ? token : token; // Reittier ist unsichtbar unter dem Reiter
    const gridPx = canvas.grid.size;
    const dist = canvas.scene.grid.distance || 5;
    const half = Math.max(src.w, src.h) / 2;
    const g = new PIXI.Graphics();
    const color = Number(`0x${(obj.mount ? "7fb069" : "e0b354")}`);
    g.lineStyle(3, color, 0.9).beginFill(color, 0.06).drawCircle(0, 0, half + (range.normal / dist) * gridPx).endFill();
    if (range.long && range.long > range.normal) {
      g.lineStyle(2, color, 0.45).drawCircle(0, 0, half + (range.long / dist) * gridPx);
    }
    g.position.set(src.center.x, src.center.y);
    (canvas.interface ?? canvas.stage).addChild(g);
    this._ring = g;
  }

  clearRing() {
    if (this._ring) {
      this._ring.destroy?.();
      this._ring = null;
    }
  }
}

/* -------------------------------------------- */
/*  Helfer                                      */
/* -------------------------------------------- */

/** Aktive Zustände/Effekte mit Symbol (Zustände, Bloodied, zeitlich begrenzte Effekte). */
function conditionsOf(actor) {
  if (!actor) return [];
  const list = Array.from(actor.appliedEffects ?? actor.effects ?? []).filter((e) => !e.disabled && !e.isSuppressed);
  const seen = new Set();
  const out = [];
  for (const e of list) {
    const img = e.img ?? e.icon;
    if (!img) continue;
    const isStatus = (e.statuses?.size ?? 0) > 0;
    if (!isStatus && !e.isTemporary) continue;
    const key = `${e.name}|${img}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: e.name, img });
  }
  return out.slice(0, 16);
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function pipsHTML(value, max) {
  const m = Math.min(Number(max) || 0, 12);
  let out = "";
  for (let i = 0; i < m; i++) out += `<i class="ach-pip ${i < value ? "on" : ""}"></i>`;
  if (max > 12) out += `<small>${value}/${max}</small>`;
  return out;
}

function isMelee(item) {
  const act = entriesForItem(item, ["action"])[0]?.activity;
  if (act?.attack?.type?.value) return act.attack.type.value === "melee";
  const wt = item.system.type?.value ?? item.system.weaponType ?? "";
  if (/M$/.test(wt)) return true;
  return ["natural", "improv"].includes(wt) && !item.system.range?.long;
}

function hasAttack(item) {
  return entriesForItem(item, ["action", "bonus"]).length > 0;
}

/** Waffensets eines Akteurs (gespeichert oder sinnvoll vorbelegt). */
export function getWeaponSets(actor) {
  const flag = foundry.utils.deepClone(actor.getFlag(ID, "weaponSets") ?? {});
  const weapons = actor.items.filter((i) => i.type === "weapon" && hasAttack(i)).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const defaults = { 1: {}, 2: {}, 3: {} };
  if (actor.type === "npc") {
    defaults[1] = { primary: weapons[0]?.id ?? null, secondary: weapons[1]?.id ?? null };
    defaults[2] = { primary: weapons[2]?.id ?? null, secondary: weapons[3]?.id ?? null };
    defaults[3] = { primary: weapons[4]?.id ?? null, secondary: weapons[5]?.id ?? null };
  } else {
    const equipped = weapons.filter((w) => w.system.equipped);
    const main = equipped[0] ?? weapons[0] ?? null;
    const off = equipped.find((w) => w !== main && w.system.properties?.has?.("lgt")) ?? null;
    defaults[1] = { primary: main?.id ?? null, secondary: off?.id ?? null };
  }
  const sets = {};
  for (const n of ["1", "2", "3"]) {
    const f = flag.sets?.[n] ?? {};
    sets[n] = {
      primary: "primary" in f ? f.primary : defaults[n].primary ?? null,
      secondary: "secondary" in f ? f.secondary : defaults[n].secondary ?? null
    };
    // Gelöschte Gegenstände entfernen
    for (const k of ["primary", "secondary"]) if (sets[n][k] && !actor.items.get(sets[n][k])) sets[n][k] = null;
  }
  return { active: String(flag.active ?? "1"), sets };
}
