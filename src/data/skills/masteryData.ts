import { HeroClass, MasteryId, MasteryNode, MasteryPath } from '@/models/types';
import { bulwark, templar, berserker } from '@/data/skills/trees/champion';
import { pyromancer, hydromancer, stormcaller } from '@/data/skills/trees/arcanist';
import { lifewarden, stoneshaper, wildshape } from '@/data/skills/trees/druid';
import { marksman, skirmisher, shadowblade } from '@/data/skills/trees/hunter';
import { mantis } from '@/data/skills/trees/mantis';
import { firefly } from '@/data/skills/trees/firefly';
import { beetle } from '@/data/skills/trees/beetle';

/**
 * The mastery paths, three per class — and the Monk's, whose trees land one at a
 * time (the private project notes): the Mantis and the Firefly so far.
 *
 * Split per class because a path is the unit of authorship — the tables are
 * long, and the shape rules they all obey are pinned in `masteryData.test.ts`
 * rather than kept true by being next to each other.
 */
export const MASTERY_PATHS: MasteryPath[] = [
  bulwark, templar, berserker,
  pyromancer, hydromancer, stormcaller,
  lifewarden, stoneshaper, wildshape,
  marksman, skirmisher, shadowblade,
  mantis,
  firefly,
  beetle,
];

export function findMasteryPath(id: MasteryId): MasteryPath | undefined {
  return MASTERY_PATHS.find((p) => p.id === id);
}

export function findMasteryNode(nodeId: string): { path: MasteryPath; node: MasteryNode } | undefined {
  for (const path of MASTERY_PATHS) {
    const node = path.nodes.find((n) => n.id === nodeId);
    if (node) return { path, node };
  }
  return undefined;
}

/** Paths a hero of this class may choose between at level 5. */
export function masteriesForClass(heroClass: HeroClass): MasteryPath[] {
  return MASTERY_PATHS.filter((p) => p.heroClass === heroClass);
}
