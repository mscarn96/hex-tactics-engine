import { HeroSkill } from '@/models/types';
import { BALANCE } from '@/data/balanceConstants';
import { canopyVenom, jorogumoWeb, silkSnare, venomFangs } from '@/data/skills/yokaiSkills';
import type { BossPassive, BossPhase } from '@/data/templates/aethelred';

/**
 * Jadeveil: Silk Hollow / Yokai — the Jorōgumo, the canopy weaver: the Silk Hollow's boss
 * (the private project notes), with the web cycle of the faction brief at
 * the core of her kit.
 *
 * Two phases. **The Canopy**: she hangs above the arena on three threads, each an
 * objective standing on the board. Up there nothing can aim at her or harm her
 * (`AuraType.Suspended`); her turns run the web cycle from above, and a hero a web still
 * holds when the bite lands is dropped on, bitten and left as she climbs back up. Cutting
 * the last thread drags her down. **Dragged Down**: she fights on the board, the web cycle
 * starting over, with her fangs and her snare between volleys.
 *
 * Which she casts and what a web or a thread does is `systems/combat/yokaiKits`,
 * `yokaiActions` and `scripts/yokai`; this is what the party reads.
 */

const SILK = '#f0ecd8';
const CRIMSON = '#c8283a';

export const JOROGUMO_PASSIVES: BossPassive[] = [
  { id: 'hung_on_silk' },
  { id: 'dragged_down' },
];

export const JOROGUMO_CANOPY_SKILLS: HeroSkill[] = [jorogumoWeb, canopyVenom];
export const JOROGUMO_GROUND_SKILLS: HeroSkill[] = [venomFangs, silkSnare, jorogumoWeb];

export const JOROGUMO_PHASES: BossPhase[] = [
  {
    id: 'jorogumo_canopy',
    threshold: 1.0,
    skills: JOROGUMO_CANOPY_SKILLS,
    color: SILK,
    presence: 1,
    passive: JOROGUMO_PASSIVES[0],
  },
  {
    id: 'jorogumo_dragged',
    // Never by health: only the last thread falling brings her down (`onLast: 'release'`)
    threshold: 0,
    stats: { attack: BALANCE.JOROGUMO_WEAVER.GROUND_POWER },
    skills: JOROGUMO_GROUND_SKILLS,
    color: CRIMSON,
    vfx: { kind: 'quake', scale: 1.6 },
    presence: 1,
    passive: JOROGUMO_PASSIVES[1],
  },
];
