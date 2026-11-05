import { BALANCE } from '@/data/balanceConstants';
import { t } from '@/i18n';
import { CombatUnit, HexCoord } from '@/models/types';
import { getHexesInRange, getNeighbors, hexDistance, hexKey } from '@/utils/hexUtils';

export interface DeploymentPlan {
  level: number;
  starts: Record<string, HexCoord>;
  area: HexCoord[];
}
/** What the Barracks' level lets the party do before the first turn, in the current language. */
export function deploymentPerk(level: number): string {
  if (level <= 0) return t('economy.deploy.default');
  if (level === 1) return t('economy.deploy.swap');
  if (level === 2) return t('economy.deploy.swapAndMove');
  return t('economy.deploy.free');
}
/** A connected one-hex expansion of authored starts, separated from the enemy line. */
export function createDeployment(level: number, players: CombatUnit[], enemies: CombatUnit[], legal: readonly HexCoord[]): DeploymentPlan {
  const living = players.filter(u => u.currentHp > 0);
  const starts = Object.fromEntries(living.map(u => [u.id, { ...u.position }]));
  const legalSet = new Set(legal.map(hexKey));
  const friendlyEdge = Math.min(...living.map(u => u.position.r)) - BALANCE.DEPLOYMENT_REACH;
  const candidates = new Map<string, HexCoord>();
  for (const player of living) for (const hex of getHexesInRange(player.position, BALANCE.DEPLOYMENT_REACH)) {
    if (legalSet.has(hexKey(hex)) && hex.r >= friendlyEdge && enemies.every(e => hexDistance(e.position, hex) >= BALANCE.DEPLOYMENT_ENEMY_GAP)) candidates.set(hexKey(hex), hex);
  }
  const queue = living.map(u => u.position).filter(h => candidates.has(hexKey(h)));
  const reached = new Set(queue.map(hexKey));
  for (let i = 0; i < queue.length; i++) {
    for (const hex of getNeighbors(queue[i])) {
      const key = hexKey(hex);
      if (!candidates.has(key) || reached.has(key)) continue;
      reached.add(key);
      queue.push(hex);
    }
  }
  return { level, starts, area: [...candidates].filter(([k]) => reached.has(k)).map(([,h]) => h) };
}
/** Atomic placements and swaps. Level 2 counts heroes outside the original set, not swap participants. */
export function placeDeployment(plan: DeploymentPlan, units: CombatUnit[], id: string, to: HexCoord): CombatUnit[] | null {
  const hero = units.find(u => u.id === id && u.isPlayer && u.currentHp > 0);
  if (!hero || plan.level <= 0 || !plan.area.some(h => hexKey(h) === hexKey(to))) return null;
  const occupied = units.find(u => u.currentHp > 0 && hexKey(u.position) === hexKey(to));
  if (occupied && !occupied.isPlayer) return null;
  if (plan.level === 1 && !occupied) return null;
  const next = units.map(u => u.id === id ? { ...u, position: { ...to } } : occupied && u.id === occupied.id ? { ...u, position: { ...hero.position } } : u);
  const startSet = new Set(Object.values(plan.starts).map(hexKey));
  const outside = next.filter(u => u.isPlayer && u.currentHp > 0 && !startSet.has(hexKey(u.position))).length;
  if ((plan.level === 1 && outside > 0) || (plan.level === 2 && outside > 1)) return null;
  return next;
}
export function deploymentTargets(plan: DeploymentPlan, units: CombatUnit[], id: string): HexCoord[] {
  return plan.area.filter(h => placeDeployment(plan, units, id, h) !== null);
}
