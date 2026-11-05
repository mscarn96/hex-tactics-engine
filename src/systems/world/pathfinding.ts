import { HexCoord, hexDistance, getNeighbors, hexKey } from '@/utils/hexUtils';

export type CostFunction = (from: HexCoord, to: HexCoord) => number | null;

interface AStarNode {
  key: string;
  coord: HexCoord;
  g: number;
  f: number;
  /** Monotonic insertion counter — heap tiebreaker so equal-f nodes pop in insertion order. */
  order: number;
  parent: AStarNode | null;
}

/** True when a should pop before b: lower f first, ties toward earlier insertion. */
function heapBefore(a: AStarNode, b: AStarNode): boolean {
  if (a.f !== b.f) return a.f < b.f;
  return a.order < b.order;
}

function heapPush(heap: AStarNode[], node: AStarNode): void {
  heap.push(node);
  let i = heap.length - 1;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!heapBefore(heap[i], heap[parent])) break;
    const tmp = heap[i];
    heap[i] = heap[parent];
    heap[parent] = tmp;
    i = parent;
  }
}

function heapPop(heap: AStarNode[]): AStarNode | undefined {
  const top = heap[0];
  const last = heap.pop();
  if (last === undefined || heap.length === 0) return top;
  heap[0] = last;
  let i = 0;
  for (;;) {
    const left = 2 * i + 1;
    const right = left + 1;
    let best = i;
    if (left < heap.length && heapBefore(heap[left], heap[best])) best = left;
    if (right < heap.length && heapBefore(heap[right], heap[best])) best = right;
    if (best === i) break;
    const tmp = heap[i];
    heap[i] = heap[best];
    heap[best] = tmp;
    i = best;
  }
  return top;
}

/**
 * A* over the hex grid. The open set is a binary min-heap on f; improved routes to an
 * already-open hex are duplicate-pushed and the stale entry skipped on pop (its g no
 * longer matches the best recorded for its key), which is simpler than decrease-key.
 *
 * `minStepCost` scales the heuristic: the cheapest cost a single step can have. The
 * default of 1 matches the historical heuristic; a world map where road steps cost 0.5
 * must pass 0.5 or the heuristic overestimates and A* can miss cheaper road detours.
 */
export function findPath(
  start: HexCoord,
  goal: HexCoord,
  costFn: CostFunction,
  maxDistance?: number,
  minStepCost: number = 1
): HexCoord[] | null {
  const heap: AStarNode[] = [];
  /** Best g recorded per open key — membership check and stale-pop filter in one. */
  const bestG = new Map<string, number>();
  const closedSet = new Set<string>();
  let order = 0;

  const startKey = hexKey(start);
  const startNode: AStarNode = {
    key: startKey,
    coord: start,
    g: 0,
    f: hexDistance(start, goal) * minStepCost,
    order: order++,
    parent: null,
  };
  bestG.set(startKey, 0);
  heapPush(heap, startNode);

  while (heap.length > 0) {
    const current = heapPop(heap)!;

    // Stale entry: this key was already expanded, or a cheaper route to it was
    // pushed after this entry. Skip it.
    if (closedSet.has(current.key)) continue;
    const recorded = bestG.get(current.key);
    if (recorded !== undefined && current.g > recorded) continue;

    if (current.coord.q === goal.q && current.coord.r === goal.r) {
      // Reconstruct path
      const path: HexCoord[] = [];
      let node: AStarNode | null = current;
      while (node) {
        path.unshift(node.coord);
        node = node.parent;
      }
      return path;
    }

    bestG.delete(current.key);
    closedSet.add(current.key);

    for (const neighbor of getNeighbors(current.coord)) {
      const nKey = hexKey(neighbor);
      if (closedSet.has(nKey)) continue;

      const cost = costFn(current.coord, neighbor);
      if (cost === null) continue; // Impassable

      const g = current.g + cost;
      if (maxDistance !== undefined && g > maxDistance) continue;

      const existing = bestG.get(nKey);
      if (existing !== undefined && g >= existing) continue;

      bestG.set(nKey, g);
      heapPush(heap, {
        key: nKey,
        coord: neighbor,
        g,
        f: g + hexDistance(neighbor, goal) * minStepCost,
        order: order++,
        parent: current,
      });
    }
  }

  return null;
}

export function getReachableHexes(
  start: HexCoord,
  maxCost: number,
  costFn: CostFunction
): Map<string, number> {
  const reachable = new Map<string, number>();
  const frontier: { coord: HexCoord; cost: number }[] = [{ coord: start, cost: 0 }];
  reachable.set(hexKey(start), 0);

  // Head-index pointer instead of shift(): shift() is O(n) per dequeue.
  let head = 0;
  while (head < frontier.length) {
    const current = frontier[head++];
    for (const neighbor of getNeighbors(current.coord)) {
      const cost = costFn(current.coord, neighbor);
      if (cost === null) continue;

      const totalCost = current.cost + cost;
      if (totalCost > maxCost) continue;

      const nKey = hexKey(neighbor);
      const existingCost = reachable.get(nKey);
      if (existingCost !== undefined && existingCost <= totalCost) continue;

      reachable.set(nKey, totalCost);
      frontier.push({ coord: neighbor, cost: totalCost });
    }
  }

  return reachable;
}
