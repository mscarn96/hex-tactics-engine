import { AfflictionType, AuraType, CombatUnit, HeroSkill } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { jorogumoBite, nueSerpentStrike } from '@/data/skills/yokaiSkills';
import { useCombatStore } from '@/stores/combatStore';
import type { BossFx } from '@/systems/combat/bossActions';
import type { Landing } from '@/systems/combat/encounterScript';
import { unitById } from '@/systems/combat/unitLookup';
import { createObjective } from '@/systems/combat/objectives';
import { canPrepare, castPrepared } from '@/systems/combat/preparedCast';
import { CombatSink, resolveSkillUse } from '@/systems/combat/skillResolution';
import { moveIntent, strikeIntent, supportIntent } from '@/systems/combat/soundIntents';
import { hasEffect, isRooted } from '@/systems/combat/statusEffects';
import { isAlive } from '@/systems/combat/targetLegality';
import { hexKey } from '@/utils/hexUtils';
import { t } from '@/i18n';
import { unitName } from '@/data/templates/unitText';
import {
  biteDash,
  biteVictim,
  dropHex,
  freeHeroes,
  heroesBeside,
  isHanging,
  isJorogumo,
  isNue,
  isWeb,
  jorogumoMemory,
  tailVictim,
  weaverPerch,
  WEB_KIND,
  webHero,
  websOf,
  webTargets,
} from '@/systems/combat/yokaiKits';

/**
 * The store-writing half of the Jorōgumo's web (`yokaiKits` decides; this puts it on the
 * board). Shared by every driver — the scene, the headless simulator, a harness — because
 * the AI's executor, the turn start and the landing call it.
 */

const SILK = '#f0ecd8';
const VENOM = '#c8f04a';

/** The bite as it is warned: the shared window, broken by a Stun or a Freeze on her. */
export const WARNED_BITE: HeroSkill = {
  ...jorogumoBite,
  prepares: { windows: 1, interruptedBy: ['stun', 'freeze'] },
};

/** Jadeveil: Silk Hollow / Yokai — the bite warned from the canopy, which nothing on the board can break. */
export const HUNG_BITE: HeroSkill = {
  ...jorogumoBite,
  prepares: { windows: 1 },
};

/**
 * Her web turn: new webs on the heroes the volley takes, and the bite announced over
 * every hero a web holds — the new ones and any left from before — owed a turn by every
 * hero still free.
 */
export function castWebVolley(spider: CombatUnit, fx: BossFx): { ok: boolean; webbed: string[] } {
  const store = useCombatStore.getState();
  const refused = { ok: false, webbed: [] as string[] };
  if (!canPrepare(spider.id)) return refused;
  const memory = jorogumoMemory(spider);
  const targets = webTargets(spider, store.units, memory.volleys + 1);
  const standing = websOf(spider, store.units);
  const held = standing.map((w) => webHero(w, store.units)).filter((h): h is CombatUnit => !!h && isAlive(h));
  if (targets.length === 0 && held.length === 0) return refused;
  if (freeHeroes(store.units).length - targets.length < 1) return refused;

  const hexes = [...held, ...targets].map((h) => h.position);
  // Up on her threads nothing reaches her, and that includes a Stun: the webs are the answer
  const bite = isHanging(spider) ? HUNG_BITE : WARNED_BITE;
  const cast = castPrepared(spider, bite, hexes[0], hexes, store.units, fx.log);
  if (!cast.ok) return refused;

  for (const hero of targets) {
    const web = createObjective({
      kind: WEB_KIND,
      owner: spider,
      position: hero.position,
      hp: 1,
      defense: 0,
      shattersOnPhase: false,
      // The bite dies with the last web standing
      bindsPrepared: cast.attack.id,
      cancelsOnLast: true,
      linkedUnitId: hero.id,
    });
    web.stats = { ...web.stats, magicDefense: 0 };
    store.spinWeb(web, hero.id);
    fx.vfx?.({
      kind: 'bolt', delivery: 'natural',
      casterId: spider.id,
      casterPos: spider.position,
      targetCoord: hero.position,
      hitUnitIds: [hero.id],
      hitCoords: [hero.position],
      color: SILK,
    });
    fx.log('  ' + t('bossLog.yokai.wrapped', { name: unitName(hero) }), SILK);
    // The silk catching, heard with the word it raises
    fx.sound?.(strikeIntent(hero, 'natural', 'hit', undefined, undefined, { contact: 'web' }));
    fx.float?.(hero.position, t('bossLog.yokai.float.webbed'), SILK);
  }
  // A web left from before now waits on this warning
  for (const web of standing) store.patchObjective(web.id, { bindsPrepared: cast.attack.id, cancelsOnLast: true });

  const units = useCombatStore.getState().units;
  store.updatePreparedAttack(cast.attack.id, {
    scripted: 'web',
    // Every hero still free owes the window; a webbed one cannot answer
    responders: freeHeroes(units).map((h) => h.id),
    bound: websOf(spider, units).map((w) => w.id),
  });
  store.patchBossScript(spider.id, {
    lastUsed: { ...(spider.bossScript?.lastUsed ?? {}), volleys: memory.volleys + 1, lastVolley: memory.turns },
  });
  return { ok: true, webbed: targets.map((h) => h.id) };
}

/**
 * The bite lands, as her turn: she dashes beside the hero a web still holds who has the
 * least health left, takes them out of the web and bites. Rooted, she bites only a hero
 * already beside her. A web cut since the warning is a hero she cannot have.
 */
export function landBite(landing: Landing, spider: CombatUnit, sink: CombatSink): void {
  const { attack } = landing;
  const store = useCombatStore.getState();
  const victim = biteVictim(spider, attack.bound ?? [], store.units);
  if (!victim) {
    sink.log('  ' + t('bossLog.yokai.websEmpty', { name: unitName(spider) }), SILK);
    return;
  }
  // From the canopy she drops beside them, whatever stands between
  if (isHanging(spider)) {
    dropAndBite(landing, spider, victim, sink);
    return;
  }
  const dash = biteDash(spider, victim, store.units, store.hazards);
  if (dash && isRooted(spider)) {
    sink.log('  ' + t('bossLog.yokai.heldFast', { name: unitName(spider), target: unitName(victim) }), SILK);
    return;
  }
  const web = store.units.find(
    (u) => isAlive(u) && isWeb(u) && u.objective?.ownerId === spider.id && u.objective.linkedUnitId === victim.id,
  );
  if (web) store.freeFromWeb(web.id, true);

  if (dash) {
    const from = spider.position;
    const ticks = store.moveUnit(spider.id, dash.to, 'dash', undefined, undefined, [from, ...dash.path]);
    sink.sound?.(moveIntent(spider.id, from, dash.to, 'dash'));
    for (const t of ticks) sink.float(dash.to, t.text, t.color);
  }
  const striker = unitById(useCombatStore.getState().units, spider.id);
  if (!striker || striker.currentHp <= 0) return;
  store.setFacing(striker.id, victim.position);
  sink.log('  ' + t('bossLog.yokai.bites', { name: unitName(striker), target: unitName(victim) }), VENOM);
  sink.lands?.(jorogumoBite, striker.position, victim.position);
  // The web held them all; the bite is the one the landing struck
  landing.blow(striker, jorogumoBite, victim.position, sink, [victim.position]);
}

/**
 * Jadeveil: Silk Hollow / Yokai — the canopy weaver's bite: she lets herself down on her
 * silk beside the webbed hero, tears them out of the web and bites, and stays there, still
 * on her threads and out of reach, until the next turn begins and she climbs back up
 * (`climbBack`). No room beside them is no bite.
 */
function dropAndBite(landing: Landing, spider: CombatUnit, victim: CombatUnit, sink: CombatSink): void {
  const store = useCombatStore.getState();
  const to = dropHex(spider, victim, store.units, store.hazards);
  if (!to) {
    sink.log('  ' + t('bossLog.yokai.noRoom', { name: unitName(spider), target: unitName(victim) }), SILK);
    return;
  }
  const web = store.units.find(
    (u) => isAlive(u) && isWeb(u) && u.objective?.ownerId === spider.id && u.objective.linkedUnitId === victim.id,
  );
  if (web) store.freeFromWeb(web.id, true);
  const from = spider.position;
  store.moveUnit(spider.id, to, 'swoop', false);
  sink.sound?.(moveIntent(spider.id, from, to, 'dash'));
  sink.log('  ' + t('bossLog.yokai.drops', { name: unitName(spider), target: unitName(victim) }), SILK);
  const striker = unitById(useCombatStore.getState().units, spider.id);
  if (!striker || striker.currentHp <= 0) return;
  store.setFacing(striker.id, victim.position);
  sink.lands?.(jorogumoBite, striker.position, victim.position);
  landing.blow(striker, jorogumoBite, victim.position, sink, [victim.position]);
}

/**
 * Between turns: a canopy weaver who dropped to bite climbs back to her perch. Held while
 * something stands on it — she waits where she is, out of reach all the same.
 */
export function climbBack(fx: BossFx): void {
  const store = useCombatStore.getState();
  for (const spider of store.units.filter((u) => isAlive(u) && isJorogumo(u) && isHanging(u))) {
    const perch = weaverPerch();
    if (hexKey(spider.position) === hexKey(perch)) continue;
    if (store.units.some((u) => isAlive(u) && u.id !== spider.id && hexKey(u.position) === hexKey(perch))) continue;
    store.moveUnit(spider.id, perch, 'swoop', false);
    fx.log('  ' + t('bossLog.yokai.climbs', { name: unitName(spider) }), SILK);
  }
}

/**
 * Between turns: a web whose owner has fallen, whose hero is gone, or that holds a hero
 * while no hero at all is left free to answer it, gives way. The last is what keeps a
 * party whose free heroes have all fallen from standing in silk for ever.
 */
export function releaseStrandedWebs(fx: BossFx): void {
  const store = useCombatStore.getState();
  const webs = store.units.filter((u) => isAlive(u) && isWeb(u));
  if (webs.length === 0) return;
  const nobodyFree = freeHeroes(store.units).length === 0;
  for (const web of webs) {
    const owner = unitById(store.units, web.objective?.ownerId ?? '');
    const hero = webHero(web, store.units);
    if (owner && isAlive(owner) && hero && isAlive(hero) && !nobodyFree) continue;
    const events = useCombatStore.getState().freeFromWeb(web.id, true);
    if (hero && isAlive(hero)) {
      fx.log('  ' + t('bossLog.yokai.webGives', { name: unitName(hero) }), SILK);
      for (const e of events) fx.float?.(hero.position, e.text, e.color);
    }
  }
}

// ── Jadeveil: Silk Hollow / Yokai — the Nue ──────────────────────────────────

const THUNDER = '#f2e46a';
const SERPENT = '#6ac04a';

/**
 * The Nue's turn start: its thundercloud Shocks every hero beside it, and its snake tail
 * strikes the hero standing directly behind it. Neither is its action; the turn that
 * follows is its own.
 */
export function beginNueTurn(nue: CombatUnit, sink: CombatSink): void {
  const store = useCombatStore.getState();
  const live = unitById(store.units, nue.id);
  if (!live || !isAlive(live) || !isNue(live)) return;

  let crackled = false;
  for (const hero of heroesBeside(live, store.units)) {
    store.applyEffect(hero.id, {
      type: AfflictionType.Shock,
      magnitude: 1,
      duration: BALANCE.NUE.SHOCK_TURNS,
      sourceUnitId: live.id,
    });
    // A ward that refused it is no Shock to announce
    const after = unitById(useCombatStore.getState().units, hero.id);
    if (!after || !hasEffect(after, AfflictionType.Shock)) continue;
    // The cloud is heard once, gathering, however many heroes it Shocks
    if (!crackled) sink.sound?.(supportIntent(live, { family: 'storm' }));
    crackled = true;
    sink.log('  ' + t('bossLog.yokai.thundercloud', { name: unitName(live), target: unitName(hero) }), THUNDER);
    sink.float(hero.position, t('bossLog.yokai.float.shocked'), THUNDER);
  }

  const units = useCombatStore.getState().units;
  const victim = tailVictim(unitById(units, live.id) ?? live, units);
  if (!victim) return;
  const striker = unitById(units, live.id) ?? live;
  sink.log('  ' + t('bossLog.yokai.serpent', { name: unitName(striker), target: unitName(victim) }), SERPENT);
  sink.lands?.(nueSerpentStrike, striker.position, victim.position);
  resolveSkillUse(striker, nueSerpentStrike, victim.position, sink, {
    resolving: true,
    fixedHexes: [victim.position],
  });
}

/** Black Thunder's second half: the cloud closes over the Nue, Stealth until its next turn. */
export function cloakNue(nue: CombatUnit, sink: CombatSink): void {
  const store = useCombatStore.getState();
  const live = unitById(store.units, nue.id);
  if (!live || !isAlive(live)) return;
  store.applyEffect(live.id, {
    type: AuraType.Stealth,
    magnitude: 1,
    duration: BALANCE.STEALTH_DURATION,
    sourceUnitId: live.id,
  });
  sink.sound?.(supportIntent(live, { family: 'stealth' }));
  sink.log('  ' + t('bossLog.yokai.cloud', { name: unitName(live) }), THUNDER);
  sink.float(live.position, t('bossLog.yokai.float.hidden'), THUNDER);
}
