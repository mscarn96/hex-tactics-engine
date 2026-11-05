import type { CombatUnit, HeroSkill, HexCoord, PreparedAttack, SoundIntent, VfxSpec } from '@/models/types';

/**
 * Where player-facing feedback goes.
 *
 * Four channels rather than one, because they are consumed by different things
 * and a simulator wants only the first. `float` takes a **hex**, not a screen
 * position — projection needs a camera, which is exactly the dependency this
 * seam exists to keep out.
 *
 * This is the one sink type: the hero resolver, the enemy executor, the turn start,
 * a warned strike landing and every boss script report through it. `EventSink`
 * (`combatEvents`) and `BossFx` (`bossActions`) are narrowed views of it, so a
 * `CombatSink` is handed straight into either. It lives in this leaf module rather
 * than in `skillResolution` because `skillResolution` imports those modules, and
 * the reverse import would close a cycle.
 */
export interface CombatSink {
  /**
   * `iconId` is an icon-map key (`skill:shadowstep`) for the line to lead with,
   * or several joined by `|` — the first one drawn wins (`skillLogIcon`).
   *
   * Optional because almost no line has one: of nineteen calls, exactly one —
   * the "who cast what" line — names a thing that has a picture. The rest are
   * consequences, and a consequence is not an ability.
   */
  log(text: string, color: string, iconId?: string): void;
  /** `delayMs` holds this number back further than the cast's own impact (Ancestral Hunt's later spirits). */
  float(at: HexCoord, text: string, color: string, delayMs?: number): void;
  vfx(spec: VfxSpec): void;
  /** A picture drawn as the blow lands, not as the skill is cast — `EventSink.impactVfx`. */
  impactVfx?(spec: VfxSpec): void;
  /**
   * A status that landed on a unit, named in that status's own colour.
   *
   * Separate from `float` so the scene can decide the *timing*: a blow that
   * damages and afflicts at once would otherwise put two texts on one anchor in
   * the same frame, and the number is the one that must not be missed.
   */
  status(at: HexCoord, label: string, color: string): void;
  /**
   * What the fight should sound like, as what happened — see `SoundIntent`.
   *
   * **Optional, and that is how the headless simulator discards it**: a sink
   * that does not supply it hears nothing, and nothing here can tell. A strike's
   * intent is sent immediately before that strike's number, on both paths, so a
   * scene can play it when the float queue lets the number onto its anchor —
   * which is when the picture of the blow has landed.
   */
  sound?(intent: SoundIntent): void;
  /**
   * Something the whole party should be told, not just the log — a wave
   * arriving. Optional for the same reason `sound` is: the simulator ignores it.
   */
  announce?(text: string): void;
  arrive?(units: CombatUnit[]): void;
  /**
   * A person is at the controls and can be asked a question (the Rime Jarl's challenge).
   * Absent in the simulator, where a hero's answer comes from policy instead.
   */
  interactive?: boolean;
  /**
   * A warned strike is about to resolve: this skill, cast from `from` at `to`.
   *
   * A player's or an enemy's action is timed by the scene, which knows what it
   * asked for before it asks; a warning lands from inside `beginTurn`, where
   * the scene knows only that a turn started. Without this its numbers floated
   * the instant its picture began — an eruption's damage over a hero before the
   * eruption had risen. Optional: the simulator has no picture to wait for.
   */
  lands?(skill: HeroSkill, from: HexCoord, to: HexCoord): void;
  /**
   * A warned strike has landed, every blow of it, and `board` is the field the moment before its
   * first. What else a turn start does (Aethelred's Overturn, a tick) is not on that board's
   * account, so a measurer reads this landing alone. Optional: the scene has no use for it.
   */
  warningLanded?(attack: PreparedAttack, board: readonly CombatUnit[]): void;
}

/**
 * For headless callers that want the rules without the theatre. It has no
 * `sound`, which is the channel discarded rather than a sound played silently.
 */
export const SILENT_SINK: CombatSink = {
  log: () => {},
  float: () => {},
  vfx: () => {},
  status: () => {},
};

/**
 * The log key for a skill: its own picture, then the one it borrows.
 *
 * Systems cannot see which pictures are drawn, so both go in and `CombatLog`
 * shows the first that exists — a skill whose own icon is approved shows it,
 * and the Basic Attack, which has none, wears its weapon's.
 */
export function skillLogIcon(skill: { id: string; icon?: string }): string {
  return skill.icon && skill.icon !== skill.id ? `skill:${skill.id}|skill:${skill.icon}` : `skill:${skill.id}`;
}
