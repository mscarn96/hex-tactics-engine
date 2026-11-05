import { HeroSkill } from '@/models/types';
export * from '@/data/skills/mastery/champion';
export * from '@/data/skills/mastery/arcanist';
export * from '@/data/skills/mastery/druid';
export * from '@/data/skills/mastery/hunter';
export * from '@/data/skills/mastery/mantis';
export * from '@/data/skills/mastery/firefly';
export * from '@/data/skills/mastery/beetle';

import * as champion from '@/data/skills/mastery/champion';
import * as arcanist from '@/data/skills/mastery/arcanist';
import * as druid from '@/data/skills/mastery/druid';
import * as hunter from '@/data/skills/mastery/hunter';
import * as mantis from '@/data/skills/mastery/mantis';
import * as firefly from '@/data/skills/mastery/firefly';
import * as beetle from '@/data/skills/mastery/beetle';

/**
 * Every tree skill, for lookup by id.
 *
 * Collected from the four class modules rather than listed by hand: the list
 * used to be 24 lines of names kept in step with the declarations above it by
 * eye, which is a way to lose a skill silently. `masteryData.test.ts` pins that
 * every node's `grantsSkill` resolves, so anything dropped here fails there.
 */
export const MASTERY_SKILLS: HeroSkill[] = [champion, arcanist, druid, hunter, mantis, firefly, beetle].flatMap((mod) =>
  Object.values(mod).filter(
    (v): v is HeroSkill => !!v && typeof v === 'object' && 'targetType' in v,
  ),
);
