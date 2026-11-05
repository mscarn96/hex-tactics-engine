import { skillName, skillDescription, statusName } from '@/data/gameText';
import type { CombatUnit, HeroSkill, HeroStats } from '@/models/types';
import { enemyTemplates } from '@/data/templates/enemyTemplates';
import { FACTIONS, type FactionId, factionName, factionTagline } from '@/data/templates/factions';
import { summonTemplates } from '@/data/templates/summonTemplates';
import { LAIR_SPECS } from '@/locations/lairs';
import { describeSkill, skillEffectLines, skillStatLine } from '@/data/display/skillDisplay';
import { statusDescription, statusDisplay } from '@/data/display/statusDisplay';
import { skillEffects } from '@/systems/combat/statusEffects';
import { passiveDescription, passiveName } from '@/systems/combat/passives';
import { phasesFor } from '@/systems/combat/bossPhases';
import { applyStatMultipliers } from '@/systems/combat/forms';
import { magicDefenseOf } from '@/systems/combat/damageType';
import { roleName, templateName, tierName } from '@/data/templates/unitText';
import { bossPassiveDescription, bossPassiveName, phaseName, phaseRule } from '@/data/templates/bossText';

export interface BestiaryAbility {
  id: string;
  name: string;
  description: string;
  /** Authored tactical instructions also explain bespoke boss actions and warnings. */
  intent: string;
  statLine: string;
  effects: string[];
  statuses: { name: string; description: string }[];
}

/**
 * The bestiary, built when shown: every text field is in the language that was
 * current at the call, so the screen rebuilds it when the language changes.
 */
export interface BestiaryEntry {
  id: string;
  name: string;
  factionId: string;
  /** The role's label: a faction role, "Lair boss", "Emperor" or "Summoned creature". */
  role: string;
  tier: 'normal' | 'elite' | 'boss' | 'summon';
  /** The tier's label. */
  tierLabel: string;
  /** Authored level-one sheet, before encounter and campaign multipliers. */
  stats: HeroStats;
  skills: BestiaryAbility[];
  passives: { name: string; description: string }[];
  phases: { name: string; rule: string; threshold: number; stats: HeroStats;
    passive: { name: string; description: string }; skills: BestiaryAbility[] }[];
}

export interface BestiaryFaction {
  id: string;
  name: string;
  tagline: string;
  entries: BestiaryEntry[];
}

export function bestiaryAbility(skill: HeroSkill): BestiaryAbility {
  return {
    id: skill.id, name: skillName(skill), description: describeSkill(skill), intent: skillDescription(skill),
    statLine: skillStatLine(skill), effects: skillEffectLines(skill),
    statuses: skillEffects(skill).map(effect => ({
      name: statusName(effect.type), description: statusDescription(effect.type),
    })),
  };
}

/** No unlocks, run state or presentation imports. Factions grow with the combat roster. */
export function buildBestiary(): BestiaryFaction[] {
  const factions: BestiaryFaction[] = FACTIONS.map(f => ({
    id: f.id, name: factionName(f.id), tagline: factionTagline(f.id), entries: [],
  }));
  const membership = new Map<string, { faction: FactionId; role: string }>();
  for (const faction of FACTIONS) {
    for (const [role, ids] of Object.entries(faction.roles)) {
      for (const id of ids) membership.set(id, { faction: faction.id, role });
    }
  }
  for (const lair of LAIR_SPECS) membership.set(lair.boss, { faction: lair.faction, role: 'lairBoss' });
  membership.set('aethelred', { faction: 'obsidian_legion', role: 'emperor' });

  const add = (entry: BestiaryEntry) => {
    let faction = factions.find(f => f.id === entry.factionId);
    if (!faction) {
      faction = { id: entry.factionId, name: factionName('other'), tagline: factionTagline('other'), entries: [] };
      factions.push(faction);
    }
    faction.entries.push(entry);
  };
  for (const template of enemyTemplates) {
    const member = membership.get(template.id);
    const stats = { ...template.baseStats, magicDefense: magicDefenseOf(template.baseStats) };
    const phases = (phasesFor(template.id) ?? []).map(phase => ({
      name: phaseName(phase), rule: phaseRule(phase), threshold: phase.threshold,
      stats: applyStatMultipliers(stats, phase.stats),
      passive: { name: bossPassiveName(phase.passive), description: bossPassiveDescription(phase.passive) },
      skills: phase.skills.map(bestiaryAbility),
    }));
    add({
      id: template.id, name: templateName(template.id), factionId: member?.faction ?? 'other',
      role: member ? roleName(member.role) : tierName(template.tier), tier: template.tier, tierLabel: tierName(template.tier), stats,
      skills: template.skills.map(bestiaryAbility),
      passives: (template.passives ?? []).map(id => ({ name: passiveName(id), description: passiveDescription(id) })), phases,
    });
  }
  // Enemy spell summons are real opponents too. Legion reinforcements alias their
  // soldier pages; their kits and sheets are borrowed from those same templates.
  const summoned = new Map<string, string>();
  for (const faction of factions) for (const entry of faction.entries) {
    const template = enemyTemplates.find(t => t.id === entry.id)!;
    const skills = [...template.skills, ...(phasesFor(entry.id) ?? []).flatMap(p => p.skills)];
    for (const skill of skills) if (skill.summons) summoned.set(skill.summons.templateId, faction.id);
  }
  for (const [id, factionId] of summoned) {
    if (reinforcementEntry[id]) continue;
    const template = summonTemplates.find(t => t.id === id);
    if (!template) throw new Error(`Bestiary: missing hostile summon ${id}`);
    add({ id, name: templateName(template.id), factionId, role: roleName('summoned'), tier: 'summon', tierLabel: tierName('summon'),
      stats: { ...template.baseStats, magicDefense: magicDefenseOf(template.baseStats) },
      skills: template.skills.map(bestiaryAbility), passives: [], phases: [] });
  }
  return factions;
}

const reinforcementEntry: Record<string, string> = {
  legion_infantry: 'obsidian_infantry', legion_knight: 'dread_knight',
};

/** Player creatures have no enemy page; hostile soldiers use their roster identity. */
export function bestiaryEntryId(unit: Pick<CombatUnit, 'isPlayer' | 'templateId'>): string | undefined {
  if (unit.isPlayer || !unit.templateId) return undefined;
  const id = reinforcementEntry[unit.templateId] ?? unit.templateId;
  if (enemyTemplates.some(template => template.id === id)) return id;
  return buildBestiary().some(f => f.entries.some(e => e.id === id)) ? id : undefined;
}
