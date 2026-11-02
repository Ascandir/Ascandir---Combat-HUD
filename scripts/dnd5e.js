/**
 * Alles, was das HUD über dnd5e (6.x) wissen muss:
 * Aktionen sortieren, Zauber gruppieren, Werte lesen, Tooltips bauen.
 */
import { ID, t, loc, esc, signed, setting } from "./const.js";

/** Aktivierungsarten je Bereich. */
export const ACTIVATION = {
  action: ["action"],
  bonus: ["bonus"],
  reaction: ["reaction"],
  special: ["special"],
  legendary: ["legendary"],
  lair: ["lair"],
  mythic: ["mythic"]
};

/** Welcher Spar-Topf (Aktion/Bonus/Reaktion) wird durch eine Aktivierungsart verbraucht? */
export function economyOf(activationType) {
  if (activationType === "action") return "action";
  if (activationType === "bonus") return "bonus";
  if (activationType === "reaction") return "reaction";
  return null;
}

/* -------------------------------------------- */
/*  Aktivitäten                                 */
/* -------------------------------------------- */

export function activitiesOf(item) {
  const acts = item?.system?.activities;
  if (!acts) return [];
  return Array.from(acts.values?.() ?? acts);
}

export function activationOf(activity) {
  return activity?.activation?.type ?? null;
}

/**
 * Einträge (Item + Aktivität) eines Gegenstands für bestimmte Aktivierungsarten.
 * Hat ein Gegenstand mehrere passende Aktivitäten, gibt es pro Aktivität einen Eintrag.
 */
export function entriesForItem(item, types) {
  const all = activitiesOf(item).filter((a) => a.type !== "cast");
  const matching = all.filter((a) => types.includes(activationOf(a)));
  if (!matching.length) return [];
  const mode = setting("explodeActivities") ?? "never";
  const explode = matching.length > 1 && (mode === "always" || (mode === "only-weapons" && item.type === "weapon"));
  if (explode) {
    return matching.map((activity) => ({
      item, activity,
      label: activity.name && activity.name !== item.name ? `${item.name}: ${activity.name}` : item.name
    }));
  }
  const preferred = matching.find((a) => a.type === "attack") ?? matching[0];
  return [{ item, activity: preferred, label: item.name, multi: matching.length > 1 }];
}

const SORT = (a, b) => (a.item.sort ?? 0) - (b.item.sort ?? 0) || a.label.localeCompare(b.label);

/**
 * Sortiert alle Gegenstände eines Akteurs für einen Bereich in Kategorien.
 * @returns {{weapons, spells, features, barFeatures, items}}
 */
export function collect(actor, types, { exclude = [] } = {}) {
  const out = { weapons: [], spells: [], features: [], barFeatures: [], items: [] };
  const barLimited = setting("limitedFeaturesInBar");
  for (const item of actor.items) {
    if (exclude.includes(item)) continue;
    const entries = entriesForItem(item, types);
    if (!entries.length) continue;
    switch (item.type) {
      case "weapon":
        out.weapons.push(...entries);
        break;
      case "spell":
        out.spells.push(...entries);
        break;
      case "feat": {
        const limited = !!(item.system.uses?.max);
        (barLimited && limited ? out.barFeatures : out.features).push(...entries);
        break;
      }
      default:
        out.items.push(...entries);
    }
  }
  for (const k of Object.keys(out)) out[k].sort(SORT);
  return out;
}

/* -------------------------------------------- */
/*  Zauber                                      */
/* -------------------------------------------- */

/** Gruppiert Zauber-Einträge wie im Zauberbuch, inkl. Plätze. */
export function spellGroups(actor, entries) {
  const hideUnprepared = setting("hideUnprepared") && actor.type === "character";
  const levels = CONFIG.DND5E.spellLevels ?? {};
  const groups = [];
  const byItem = new Map();
  const rest = [];

  for (const e of entries) {
    const cachedFor = e.item.flags?.dnd5e?.cachedFor;
    if (cachedFor) {
      let source = null;
      try {
        source = fromUuidSync(`${actor.uuid}${cachedFor}`)?.item ?? null;
      } catch { /* ignorieren */ }
      const key = source?.id ?? "magic";
      if (!byItem.has(key)) byItem.set(key, { source, entries: [] });
      byItem.get(key).entries.push(e);
      continue;
    }
    const sys = e.item.system;
    const method = sys.method ?? sys.preparation?.mode;
    const prepared = sys.prepared ?? (sys.preparation?.prepared ? 1 : 0);
    if (hideUnprepared && Number(sys.level) > 0 && method === "spell" && !prepared) continue;
    rest.push(e);
  }

  for (const { source, entries: list } of byItem.values()) {
    const uses = source?.system?.uses;
    groups.push({
      label: source?.name ?? t("Spells.Items"),
      entries: list,
      slots: uses?.max ? { value: uses.value ?? uses.max - (uses.spent ?? 0), max: uses.max } : null
    });
  }

  const methodOf = (e) => e.item.system.method ?? e.item.system.preparation?.mode;
  const take = (fn) => rest.filter(fn);
  const atwill = take((e) => methodOf(e) === "atwill");
  const innate = take((e) => methodOf(e) === "innate");
  const special = new Set([...atwill, ...innate]);
  const cantrips = take((e) => !special.has(e) && Number(e.item.system.level) === 0);
  const pact = take((e) => !special.has(e) && methodOf(e) === "pact" && Number(e.item.system.level) > 0);

  if (atwill.length) groups.push({ label: loc("DND5E.SpellPrepAtWill") || t("Spells.AtWill"), entries: atwill });
  if (innate.length) groups.push({ label: loc("DND5E.SpellPrepInnate") || t("Spells.Innate"), entries: innate });
  if (cantrips.length) groups.push({ label: loc(levels[0]) || t("Spells.Cantrips"), entries: cantrips });
  if (pact.length) {
    const p = actor.system.spells?.pact ?? {};
    groups.push({ label: loc("DND5E.PactMagic") || t("Spells.Pact"), entries: pact, slots: { value: p.value ?? 0, max: p.max ?? 0 } });
  }
  for (const [lvl, label] of Object.entries(levels)) {
    const n = Number(lvl);
    if (!n) continue;
    const list = rest.filter((e) => !special.has(e) && methodOf(e) !== "pact" && Number(e.item.system.level) === n);
    if (!list.length) continue;
    const s = actor.system.spells?.[`spell${n}`] ?? {};
    groups.push({ label: loc(label), entries: list, slots: { value: s.value ?? 0, max: s.max ?? 0 } });
  }
  for (const g of groups) g.entries.sort(SORT);
  return groups;
}

/* -------------------------------------------- */
/*  Mengen / Ladungen                           */
/* -------------------------------------------- */

export function quantityOf(entry) {
  const { item, activity } = entry;
  if (!item) return null;
  try {
    const uses = item.system.uses;
    if (uses?.max) return uses.value ?? Math.max(0, uses.max - (uses.spent ?? 0));
    const other = activity?.consumption?.targets?.find?.((tg) => tg.type === "itemUses");
    if (other) {
      const target = item.parent?.items.get(other.target);
      const u = target?.system?.uses;
      if (u?.max) return u.value ?? Math.max(0, u.max - (u.spent ?? 0));
    }
    if (activity?.uses?.max) return activity.uses.value ?? Math.max(0, activity.uses.max - (activity.uses.spent ?? 0));
    if (item.type === "weapon" && item.system.properties?.has?.("amm")) {
      const ammo = item.system.ammunitionOptions?.find?.((o) => o.item)?.item
        ?? item.parent?.items.get(item.system.ammunition?.type);
      if (ammo?.system?.quantity != null) return Math.floor(ammo.system.quantity);
    }
    if (item.type === "consumable") return item.system.quantity ?? null;
  } catch { /* ignorieren */ }
  return null;
}

/* -------------------------------------------- */
/*  Reichweite                                  */
/* -------------------------------------------- */

export function rangeOf(activity) {
  const r = activity?.range;
  if (!r) return null;
  const grid = canvas?.scene?.grid?.distance ?? 5;
  if (r.units === "touch") return { normal: grid, long: null };
  if (["ft", "m", "mi", "km"].includes(r.units) || r.value) {
    let normal = Number(r.value) || null;
    let long = Number(r.long) || null;
    if (!normal && activity.type === "attack") normal = Number(activity.item?.system?.range?.reach) || grid;
    return normal ? { normal, long } : null;
  }
  if (activity.type === "attack" && activity.attack?.type?.value === "melee") {
    return { normal: Number(activity.item?.system?.range?.reach) || grid, long: null };
  }
  return null;
}

/* -------------------------------------------- */
/*  Akteurs-Werte                               */
/* -------------------------------------------- */

export function describeActor(actor) {
  const sys = actor.system;
  if (actor.type === "npc") {
    const cr = sys.details?.cr;
    const crText = cr == null ? "" : cr >= 1 || cr <= 0 ? `${cr}` : `1/${Math.round(1 / cr)}`;
    const typeKey = sys.details?.type?.value;
    const type = loc(CONFIG.DND5E.creatureTypes?.[typeKey]?.label ?? CONFIG.DND5E.creatureTypes?.[typeKey]) || sys.details?.type?.custom || "";
    return [crText ? t("Portrait.CR", { cr: crText }) : "", type].filter(Boolean).join(" ");
  }
  if (actor.type === "character") {
    const classes = Object.values(actor.classes ?? {}).map((c) => c.name).join(" / ");
    const race = sys.details?.race;
    const raceName = typeof race === "string" ? race : race?.name ?? "";
    const lvl = sys.details?.level ?? "";
    return `${t("Portrait.Level", { level: lvl })} ${classes}${raceName ? ` (${raceName})` : ""}`.trim();
  }
  return "";
}

export function speedOf(actor, mode = "walk") {
  const m = actor?.system?.attributes?.movement ?? {};
  const speeds = m.speeds ?? m;
  const v = Number(speeds[mode]);
  if (v) return v;
  return Number(speeds.walk) || 0;
}

export function stats(actor) {
  const a = actor.system.attributes ?? {};
  const hp = a.hp ?? {};
  return {
    hp: (hp.value ?? 0) + (hp.temp ?? 0),
    hpMax: (hp.max ?? 0) + (hp.tempmax ?? 0),
    hpTemp: !!hp.temp,
    hpTempMax: Number(hp.tempmax) || 0,
    hpPct: hp.max ? Math.max(0, Math.min(1, (hp.value ?? 0) / hp.max)) : 0,
    ac: a.ac?.value ?? "–",
    dc: a.spell?.dc ?? actor.system.attributes?.spelldc ?? null,
    hasSpells: actor.items.some((i) => i.type === "spell"),
    speed: speedOf(actor),
    death: { success: a.death?.success ?? 0, failure: a.death?.failure ?? 0 }
  };
}

/* -------------------------------------------- */
/*  Rettungswürfe / Fertigkeiten / Werkzeuge    */
/* -------------------------------------------- */

const PROF_ICON = {
  0: "far fa-circle",
  0.5: "fas fa-adjust",
  1: "fas fa-check",
  2: "fas fa-check-double"
};

function toolLabel(key) {
  try {
    const l = globalThis.dnd5e?.documents?.Trait?.keyLabel?.(key, { trait: "tool" });
    if (l) return l;
  } catch { /* ignorieren */ }
  const cfg = CONFIG.DND5E.toolProficiencies?.[key] ?? CONFIG.DND5E.vehicleTypes?.[key];
  if (cfg) return loc(cfg.label ?? cfg);
  const tool = CONFIG.DND5E.tools?.[key];
  const uuid = typeof tool === "string" ? tool : tool?.id;
  if (uuid) {
    try {
      const n = fromUuidSync(uuid)?.name;
      if (n) return n;
    } catch { /* ignorieren */ }
  }
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function drawerData(actor) {
  const sys = actor.system;
  const abilities = Object.entries(sys.abilities ?? {}).map(([key, ab]) => {
    const check = (ab.mod ?? 0) + (Number(ab.check?.bonus ?? ab.checkBonus) || 0);
    const save = typeof ab.save === "object" ? ab.save?.value : ab.save;
    return {
      key,
      label: loc(CONFIG.DND5E.abilities[key]?.label ?? key),
      check: signed(check),
      save: signed(save ?? ab.mod),
      saveProf: PROF_ICON[ab.proficient ?? 0] ?? PROF_ICON[0]
    };
  });
  const skills = Object.entries(sys.skills ?? {}).map(([key, sk]) => ({
    key,
    label: loc(CONFIG.DND5E.skills[key]?.label ?? key),
    total: signed(sk.total ?? sk.mod),
    passive: sk.passive ?? "",
    prof: PROF_ICON[sk.value ?? sk.proficient ?? 0] ?? PROF_ICON[0]
  })).sort((a, b) => a.label.localeCompare(b.label));
  const tools = Object.entries(sys.tools ?? {}).map(([key, tl]) => {
    const mult = tl.prof?.multiplier ?? tl.value ?? 0;
    const total = tl.total ?? (tl.mod ?? 0) + mult * (sys.attributes?.prof ?? 0);
    return { key, label: toolLabel(key), total: signed(total), prof: PROF_ICON[mult] ?? PROF_ICON[0] };
  });
  return { abilities, skills, tools };
}

export async function roll(actor, kind, key, event) {
  const cfg = { event };
  switch (kind) {
    case "check":
      return actor.rollAbilityCheck?.({ ...cfg, ability: key }) ?? actor.rollAbilityTest?.(key, { event });
    case "save":
      return actor.rollSavingThrow?.({ ...cfg, ability: key }) ?? actor.rollAbilitySave?.(key, { event });
    case "skill":
      return actor.rollSkill({ ...cfg, skill: key });
    case "tool":
      return actor.rollToolCheck({ ...cfg, tool: key });
    case "death":
      return actor.rollDeathSave({ ...cfg });
  }
}

/* -------------------------------------------- */
/*  Standardaktionen                            */
/* -------------------------------------------- */

/** Standardaktionen der Regeln. status = Zustand, der umgeschaltet wird. */
export const BASIC_ACTIONS = [
  { id: "dash", icon: "fas fa-person-running", economy: "action", dash: true },
  { id: "disengage", icon: "fas fa-person-walking-arrow-right", economy: "action", status: "disengaged" },
  { id: "dodge", icon: "fas fa-shield-halved", economy: "action", status: "dodging" },
  { id: "help", icon: "fas fa-handshake-angle", economy: "action" },
  { id: "hide", icon: "fas fa-user-ninja", economy: "action", skill: "ste" },
  { id: "ready", icon: "fas fa-hourglass-half", economy: "action" },
  { id: "search", icon: "fas fa-magnifying-glass", economy: "action", skill: "prc" },
  { id: "study", icon: "fas fa-book-open-reader", economy: "action", skill: "inv" },
  { id: "influence", icon: "fas fa-comments", economy: "action" },
  { id: "utilize", icon: "fas fa-hand", economy: "action" }
];

/** Aktionen eines kontrollierten Reittiers (PHB: nur Spurten, Rückzug, Ausweichen). */
export const MOUNT_BASIC = ["dash", "disengage", "dodge"];

export async function postBasicAction(actor, action, { mountOf = null } = {}) {
  const name = t(`Basic.${action.id}.Name`);
  const desc = t(`Basic.${action.id}.Desc`);
  const by = mountOf ? `<p class="ach-chat-sub">${esc(t("Mount.ControlledBy", { rider: mountOf.name }))}</p>` : "";
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<div class="ach-chat-card"><header><i class="${action.icon}"></i> <strong>${esc(name)}</strong></header>${by}<p>${esc(desc)}</p></div>`
  });
  if (action.status && CONFIG.statusEffects?.some((s) => s.id === action.status) && actor.isOwner) {
    await actor.toggleStatusEffect(action.status, { active: true });
  }
  if (action.skill && actor.system.skills?.[action.skill]) {
    await actor.rollSkill({ skill: action.skill });
  }
}

/* -------------------------------------------- */
/*  Tooltips                                    */
/* -------------------------------------------- */

const DAMAGE_ICON = {
  acid: "fa-flask", bludgeoning: "fa-hammer", cold: "fa-snowflake", fire: "fa-fire", force: "fa-hand-sparkles",
  lightning: "fa-bolt", necrotic: "fa-skull", piercing: "fa-crosshairs", poison: "fa-skull-crossbones",
  psychic: "fa-brain", radiant: "fa-sun", slashing: "fa-khanda", thunder: "fa-bell", healing: "fa-heart",
  temphp: "fa-heart-circle-plus"
};

function damageLabel(type) {
  const cfg = CONFIG.DND5E.damageTypes?.[type] ?? CONFIG.DND5E.healingTypes?.[type];
  return loc(cfg?.label ?? cfg ?? type);
}

function rangeLabel(activity) {
  const lbl = activity?.labels?.range ?? activity?.item?.labels?.range;
  if (lbl) return lbl;
  const r = activity?.range;
  if (!r) return null;
  if (r.units === "self") return loc("DND5E.DistSelf") || "Selbst";
  if (r.units === "touch") return loc("DND5E.DistTouch") || "Berührung";
  if (r.value) return `${r.value}${r.long ? `/${r.long}` : ""} ${r.units ?? ""}`.trim();
  return null;
}

export async function tooltipData(entry) {
  const { item, activity } = entry;
  if (!item) return null;
  const sys = item.system;
  const details = [];
  const props = [];
  let subtitle = "";

  const range = rangeLabel(activity);
  const target = activity?.labels?.target ?? item.labels?.target;
  if (range) details.push({ label: t("Tooltip.Range"), value: range });
  if (target) details.push({ label: t("Tooltip.Target"), value: target });
  const toHit = activity?.labels?.toHit ?? item.labels?.toHit;
  if (toHit) details.push({ label: t("Tooltip.ToHit"), value: toHit });
  const save = activity?.labels?.save ?? (activity?.save?.dc?.value
    ? `${t("Portrait.DC")} ${activity.save.dc.value} ${(Array.from(activity.save.ability ?? [])).map((a) => CONFIG.DND5E.abilities[a]?.abbreviation ?? a).join("/")}`
    : null);
  if (save) details.push({ label: t("Tooltip.Save"), value: save });

  let damage = activity?.labels?.damage ?? activity?.labels?.damages ?? item.labels?.damages ?? [];
  if (!Array.isArray(damage)) damage = [];
  if (!damage.length && activity?.damage?.parts?.length) {
    damage = activity.damage.parts.map((p) => ({ formula: p.formula ?? `${p.number ?? ""}d${p.denomination ?? ""}${p.bonus ? `+${p.bonus}` : ""}`, damageType: Array.from(p.types ?? [])[0] }));
  }
  if (!damage.length && activity?.healing) {
    const h = activity.healing;
    damage = [{ formula: h.formula ?? `${h.number ?? ""}d${h.denomination ?? ""}${h.bonus ? `+${h.bonus}` : ""}`, damageType: "healing" }];
  }
  if (damage.length) {
    const dmg = damage
      .filter((d) => d?.formula)
      .map((d) => `${esc(d.formula)} <i class="fas ${DAMAGE_ICON[d.damageType] ?? "fa-burst"}" data-tooltip="${esc(damageLabel(d.damageType))}"></i>`)
      .join(" + ");
    if (dmg) details.push({ label: t("Tooltip.Damage"), value: dmg, html: true });
    for (const d of damage) if (d?.damageType) props.push({ label: damageLabel(d.damageType), primary: true });
  }

  switch (item.type) {
    case "weapon": {
      const wt = CONFIG.DND5E.weaponTypes?.[sys.type?.value ?? sys.weaponType];
      subtitle = loc(wt?.label ?? wt) || "";
      for (const p of sys.properties ?? []) {
        const cfg = CONFIG.DND5E.itemProperties?.[p];
        if (cfg) props.push({ label: loc(cfg.label ?? cfg) });
      }
      const mastery = sys.mastery;
      if (mastery) {
        const m = CONFIG.DND5E.weaponMasteries?.[mastery];
        props.push({ label: loc(m?.label ?? mastery), primary: true });
      }
      break;
    }
    case "spell": {
      const lvl = loc(CONFIG.DND5E.spellLevels?.[sys.level]);
      const school = CONFIG.DND5E.spellSchools?.[sys.school];
      subtitle = [lvl, loc(school?.label ?? school)].filter(Boolean).join(" · ");
      const comps = item.labels?.components?.all ?? [];
      for (const c of comps) props.push({ label: c.abbr ?? c.label ?? c });
      const dur = item.labels?.duration;
      if (dur) details.push({ label: t("Tooltip.Duration"), value: dur });
      if (item.labels?.concentration || sys.properties?.has?.("concentration")) props.push({ label: loc("DND5E.Concentration") || "Konzentration", primary: true });
      if (item.labels?.materials) details.push({ label: t("Tooltip.Materials"), value: item.labels.materials });
      break;
    }
    case "feat": {
      const ft = CONFIG.DND5E.featureTypes?.[sys.type?.value];
      subtitle = [loc(ft?.label), sys.requirements].filter(Boolean).join(" · ");
      break;
    }
    case "consumable": {
      const ct = CONFIG.DND5E.consumableTypes?.[sys.type?.value];
      subtitle = loc(ct?.label ?? ct) || "";
      break;
    }
    default:
      subtitle = loc(CONFIG.Item.typeLabels?.[item.type]) || "";
  }

  const activationLabel = activity?.labels?.activation ?? item.labels?.activation;
  if (activationLabel) details.unshift({ label: t("Tooltip.Activation"), value: activationLabel });

  const identified = sys.identified !== false;
  let description = identified ? sys.description?.value : sys.description?.unidentified ?? sys.description?.value;
  if (description) {
    try {
      const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
      description = await TE.enrichHTML(description, { relativeTo: item, rollData: item.getRollData?.(), secrets: item.isOwner });
    } catch { /* roh lassen */ }
  }

  return {
    title: entry.label ?? item.name,
    img: item.img,
    subtitle,
    description: description ?? "",
    details,
    properties: props.filter((p, i, arr) => p.label && arr.findIndex((q) => q.label === p.label) === i)
  };
}
