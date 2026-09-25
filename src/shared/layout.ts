import type { Layout } from './state'

/** Binary split tree ops. Pure, no side effects — the store wires these into per-tab layouts. */

export type Dir = 'h' | 'v'
export type Side = 'before' | 'after'
/** Which child a step in a tree path takes. */
export type PathStep = 'a' | 'b'

/** Hard cap enforced by splitLeaf: a tab may never grow past this many panes. */
export const MAX_PANES = 9

/** Minimum pane size (px) below which a split/move is refused rather than producing a sliver. */
export const MIN_PANE_WIDTH = 200
export const MIN_PANE_HEIGHT = 120

const RATIO_MIN = 0.12
const RATIO_MAX = 0.88

function clampRatio(r: number): number {
  if (Number.isNaN(r)) return 0.5
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, r))
}

/**
 * Columns × rows for a balanced grid of `n` panes (n from 1 to MAX_PANES). Favors wide rows
 * over tall ones, matching how terminal panes read best: 1×1, 2×1, 3×1, 2×2, 3×2, 3×3.
 */
export function gridDims(n: number): [cols: number, rows: number] {
  if (n <= 1) return [1, 1]
  if (n === 2) return [2, 1]
  if (n === 3) return [3, 1]
  if (n === 4) return [2, 2]
  if (n <= 6) return [3, 2]
  return [3, 3]
}

/** Chain `nodes` into a balanced split along `dir`: every node ends up the same size. */
function chainEven(nodes: Layout[], dir: Dir): Layout {
  function build(items: Layout[]): Layout {
    if (items.length === 1) return items[0]!
    return { type: 'split', dir, ratio: 1 / items.length, a: items[0]!, b: build(items.slice(1)) }
  }
  return build(nodes)
}

/**
 * A balanced grid layout tiling every id in `ids` (order preserved, row-major), sized by
 * `gridDims`. Rows get the leftover ids when `ids.length` doesn't divide evenly (earlier rows
 * get the extra). Returns null for an empty list; a single id is just its leaf.
 */
export function buildGrid(ids: string[]): Layout | null {
  if (ids.length === 0) return null
  if (ids.length === 1) return { type: 'leaf', terminalId: ids[0]! }
  const [, rows] = gridDims(ids.length)
  const base = Math.floor(ids.length / rows)
  const extra = ids.length % rows
  const rowNodes: Layout[] = []
  let i = 0
  for (let r = 0; r < rows; r++) {
    const count = base + (r < extra ? 1 : 0)
    const rowIds = ids.slice(i, i + count)
    i += count
    rowNodes.push(chainEven(rowIds.map((id) => ({ type: 'leaf', terminalId: id }) as Layout), 'h'))
  }
  return chainEven(rowNodes, 'v')
}

/** Terminal ids of every leaf, left-to-right / top-to-bottom (a before b). */
export function leaves(layout: Layout | null): string[] {
  if (!layout) return []
  if (layout.type === 'leaf') return [layout.terminalId]
  return [...leaves(layout.a), ...leaves(layout.b)]
}

export function countLeaves(layout: Layout | null): number {
  return leaves(layout).length
}

/** The leaf node for a terminal id, or null if it isn't in the tree. */
export function findLeaf(layout: Layout | null, terminalId: string): Layout | null {
  if (!layout) return null
  if (layout.type === 'leaf') return layout.terminalId === terminalId ? layout : null
  return findLeaf(layout.a, terminalId) ?? findLeaf(layout.b, terminalId)
}

/**
 * Split the leaf `leafId` into a new `{dir}` split, inserting `newId` as a fresh leaf
 * `side` of it (before = new leaf comes first). No-ops (returns the same `layout` reference)
 * when: layout is null, leafId isn't found, newId is already present, or the tree is already
 * at MAX_PANES leaves.
 */
export function splitLeaf(layout: Layout | null, leafId: string, dir: Dir, newId: string, side: Side = 'after'): Layout | null {
  if (!layout) return layout
  if (countLeaves(layout) >= MAX_PANES) return layout
  if (leaves(layout).includes(newId)) return layout

  function go(node: Layout): Layout {
    if (node.type === 'leaf') {
      if (node.terminalId !== leafId) return node
      const fresh: Layout = { type: 'leaf', terminalId: newId }
      const a = side === 'before' ? fresh : node
      const b = side === 'before' ? node : fresh
      return { type: 'split', dir, ratio: 0.5, a, b }
    }
    const a = go(node.a)
    if (a !== node.a) return { ...node, a }
    const b = go(node.b)
    if (b !== node.b) return { ...node, b }
    return node
  }

  return go(layout)
}

interface ChainStep {
  node: Extract<Layout, { type: 'split' }>
  side: PathStep
}

/** Root-to-leaf path of split ancestors (with which side was taken at each), or null if not found. */
function findChainPath(layout: Layout, leafId: string, path: ChainStep[] = []): ChainStep[] | null {
  if (layout.type === 'leaf') return layout.terminalId === leafId ? path : null
  return findChainPath(layout.a, leafId, [...path, { node: layout, side: 'a' }]) ?? findChainPath(layout.b, leafId, [...path, { node: layout, side: 'b' }])
}

/**
 * How many leaves already share the same-direction chain that a new `dir` split next to
 * `leafId` would join. If `leafId`'s immediate parent isn't already a `dir` split (including
 * when `leafId` is the whole tree), this is just 1 — a fresh 2-way chain is about to start.
 * Used to estimate the resulting pane size before committing to a split (see splitPane in
 * main/ipc.ts) — the actual post-split sizing/refusal is a renderer-side pixel measurement,
 * this only answers "how many ways would the space end up divided".
 */
export function chainSize(layout: Layout | null, leafId: string, dir: Dir): number {
  if (!layout) return 0
  const path = findChainPath(layout, leafId)
  if (!path) return 0
  if (path.length === 0 || path[path.length - 1]!.node.dir !== dir) return 1
  let i = path.length - 1
  while (i > 0 && path[i - 1]!.node.dir === dir) i--
  function count(node: Layout): number {
    if (node.type === 'split' && node.dir === dir) return count(node.a) + count(node.b)
    return 1
  }
  return count(path[i]!.node)
}

/**
 * Rebalance the chain of same-direction splits containing `leafId` so every pane in it ends
 * up equal (iTerm/tmux "select balanced"), instead of the halved-again-and-again ratios that
 * `splitLeaf` on its own produces after repeated splits (2 columns at 50/50, split one of them
 * again and it's 50/25/25, again and it's 50/25/12.5/12.5 — thin slivers next to one wide
 * pane). Walks up from the leaf through same-direction ancestors, flattens that whole run
 * (stopping at any leaf or differently-directed split, which are kept as opaque units) into a
 * flat list, and rebuilds it with equal ratios. No-op if `leafId` isn't found or is the root.
 */
export function rebalanceChain(layout: Layout | null, leafId: string): Layout | null {
  if (!layout) return layout
  const found = findChainPath(layout, leafId)
  if (!found || found.length === 0) return layout
  const path: ChainStep[] = found

  const dir = path[path.length - 1]!.node.dir
  let chainRootIndex = path.length - 1
  while (chainRootIndex > 0 && path[chainRootIndex - 1]!.node.dir === dir) chainRootIndex--
  const chainRoot = path[chainRootIndex]!.node

  function flatten(node: Layout): Layout[] {
    if (node.type === 'split' && node.dir === dir) return [...flatten(node.a), ...flatten(node.b)]
    return [node]
  }
  const rebuilt = chainEven(flatten(chainRoot), dir)

  function spine(depth: number): Layout {
    if (depth === chainRootIndex) return rebuilt
    const { node, side } = path[depth]!
    return side === 'a' ? { ...node, a: spine(depth + 1) } : { ...node, b: spine(depth + 1) }
  }
  return spine(0)
}

/**
 * Remove the leaf `leafId`. Its parent split collapses: the sibling subtree takes the
 * parent's place. Returns null if the whole tree was just that one leaf. No-op (same
 * reference) if leafId isn't found.
 */
export function removeLeaf(layout: Layout | null, leafId: string): Layout | null {
  if (!layout) return null
  if (layout.type === 'leaf') return layout.terminalId === leafId ? null : layout
  const a = removeLeaf(layout.a, leafId)
  const b = removeLeaf(layout.b, leafId)
  if (a === layout.a && b === layout.b) return layout
  if (a === null) return b
  if (b === null) return a
  return { ...layout, a, b }
}

/** Swap the terminal at leaf `leafId` for `newId` in place, keeping the tree shape. */
export function replaceLeaf(layout: Layout | null, leafId: string, newId: string): Layout | null {
  if (!layout) return layout
  function go(node: Layout): Layout {
    if (node.type === 'leaf') return node.terminalId === leafId ? { type: 'leaf', terminalId: newId } : node
    const a = go(node.a)
    if (a !== node.a) return { ...node, a }
    const b = go(node.b)
    if (b !== node.b) return { ...node, b }
    return node
  }
  return go(layout)
}

/**
 * Set the ratio of the split node reached by `path` (a sequence of 'a'/'b' child steps from
 * the root). Clamped to [0.12, 0.88]. No-op if the path doesn't land on a split node.
 */
export function setRatio(layout: Layout | null, path: PathStep[], ratio: number): Layout | null {
  if (!layout) return layout
  const clamped = clampRatio(ratio)
  function go(node: Layout, remaining: PathStep[]): Layout {
    if (node.type !== 'split') return node
    if (remaining.length === 0) return clamped === node.ratio ? node : { ...node, ratio: clamped }
    const [head, ...rest] = remaining
    if (head === 'a') {
      const a = go(node.a, rest)
      return a === node.a ? node : { ...node, a }
    }
    const b = go(node.b, rest)
    return b === node.b ? node : { ...node, b }
  }
  return go(layout, path)
}

/**
 * Swap the terminals at two leaves within the same tree in one pass (unlike two sequential
 * `replaceLeaf` calls, this never risks matching the same leaf twice). No-op (same reference)
 * if neither id is present.
 */
export function swapLeaves(layout: Layout | null, idA: string, idB: string): Layout | null {
  if (!layout || idA === idB) return layout
  function go(node: Layout): Layout {
    if (node.type === 'leaf') {
      if (node.terminalId === idA) return { type: 'leaf', terminalId: idB }
      if (node.terminalId === idB) return { type: 'leaf', terminalId: idA }
      return node
    }
    const a = go(node.a)
    const b = go(node.b)
    if (a === node.a && b === node.b) return node
    return { ...node, a, b }
  }
  return go(layout)
}
