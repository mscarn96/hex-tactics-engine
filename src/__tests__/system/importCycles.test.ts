import fs from 'fs';
import path from 'path';
import { SRC_DIR } from '../support/paths';

/**
 * No require cycles between the layers that have state in them.
 *
 * Metro allows a cycle and prints a warning, which is why two of them survived
 * for as long as they did:
 *
 * ```
 * Require cycle: stores/partyStore -> systems/progression/statCalc -> stores/worldMapStore -> stores/partyStore
 * Require cycle: systems/progression/statCalc -> stores/worldMapStore -> systems/progression/statCalc
 * ```
 *
 * A cycle is a module that can be reached before it has finished evaluating, so
 * what it actually produces is an `undefined` binding at import time — invisible
 * until the one unlucky ordering, and then a crash a long way from the cause.
 * Both of those were one edge: `statCalc` reached into `worldMapStore` for a
 * single number, the week, to expire a barracks drill. That number lives on
 * `calendarStore` now, which imports nothing but `BALANCE` and therefore cannot
 * be in a cycle however the layers above it grow.
 *
 * Scoped to `stores/`, `systems/` and `data/` — the layers the private project notes says the
 * import graph must flow one way through. `components/` is excluded because a
 * scene importing a sibling scene is not the same hazard: those are React
 * components, evaluated on render rather than at module scope.
 *
 * Static, not runtime, for the reason `lighting.test.ts` gives about a stray
 * `<ambientLight>`: a cycle reappearing is a failure nothing at runtime can be
 * relied on to observe.
 */

const SCANNED = ['stores', 'systems', 'data'];

/** `@/foo/bar` and relative specifiers, from `import` and `export … from`. */
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  for (const dir of SCANNED) walk(path.join(SRC_DIR, dir));
  return out;
}

/** A module id this test speaks in: `stores/worldMapStore`, extension dropped. */
function moduleId(absolute: string): string {
  const rel = path.relative(SRC_DIR, absolute);
  return rel.replace(/\\/g, '/').replace(/\.tsx?$/, '').replace(/\/index$/, '');
}

/** Resolve a specifier to a module id, or `null` if it leaves the scanned set. */
function resolve(specifier: string, fromId: string): string | null {
  let id: string;
  if (specifier.startsWith('@/')) {
    id = specifier.slice(2);
  } else if (specifier.startsWith('.')) {
    id = path.posix.normalize(path.posix.join(path.posix.dirname(fromId), specifier));
  } else {
    return null; // node_modules
  }
  id = id.replace(/\/index$/, '');
  return SCANNED.some((dir) => id === dir || id.startsWith(`${dir}/`)) ? id : null;
}

function buildGraph(): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const file of sourceFiles()) {
    const id = moduleId(file);
    const src = fs.readFileSync(file, 'utf8');
    const edges = new Set<string>();
    for (const match of src.matchAll(IMPORT_RE)) {
      const target = resolve(match[1], id);
      // A module importing itself is not a cycle worth reporting
      if (target && target !== id) edges.add(target);
    }
    graph.set(id, [...edges]);
  }
  return graph;
}

/**
 * Every cycle in the graph, as `a -> b -> a` strings.
 *
 * Depth-first with an explicit stack rather than Tarjan: the graph is a few
 * hundred nodes, and what a failure has to hand the reader is the actual route
 * round — "there is a strongly connected component" is not something anyone can
 * act on.
 */
function findCycles(graph: Map<string, string[]>): string[] {
  const found = new Set<string>();
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string) => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const at = stack.indexOf(id);
      // Rotated to start at the smallest member, so one cycle reached by two
      // different routes is reported once rather than twice.
      const loop = stack.slice(at);
      const pivot = loop.indexOf([...loop].sort()[0]);
      found.add([...loop.slice(pivot), ...loop.slice(0, pivot), loop[pivot]].join(' -> '));
      return;
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const next of graph.get(id) ?? []) visit(next);
    stack.pop();
    state.set(id, 'done');
  };

  for (const id of [...graph.keys()].sort()) visit(id);
  return [...found].sort();
}

describe('the import graph', () => {
  it('has no cycles through stores, systems or data', () => {
    // Collected into an array rather than asserted per module: this Jest version
    // takes no message argument on `expect()`, so the offenders *are* the report.
    expect(findCycles(buildGraph())).toEqual([]);
  });

  it('leaves the calendar reachable from anywhere without one', () => {
    const graph = buildGraph();
    // The whole point of the store: it imports nothing that could import it.
    expect(graph.get('stores/calendarStore')).toEqual(['data/balanceConstants']);
  });
});
