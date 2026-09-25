import {
  buildGrid,
  chainSize,
  countLeaves,
  findLeaf,
  gridDims,
  leaves,
  MAX_PANES,
  rebalanceChain,
  removeLeaf,
  replaceLeaf,
  setRatio,
  splitLeaf,
  swapLeaves,
  type PathStep
} from '../src/shared/layout'
import type { Layout } from '../src/shared/state'

const leaf = (id: string): Layout => ({ type: 'leaf', terminalId: id })
const split = (dir: 'h' | 'v', a: Layout, b: Layout, ratio = 0.5): Layout => ({ type: 'split', dir, ratio, a, b })

describe('leaves / countLeaves / findLeaf', () => {
  it('null layout has no leaves', () => {
    expect(leaves(null)).toEqual([])
    expect(countLeaves(null)).toBe(0)
    expect(findLeaf(null, 'a')).toBeNull()
  })

  it('collects leaves left-to-right / a-before-b', () => {
    const l = split('h', leaf('a'), split('v', leaf('b'), leaf('c')))
    expect(leaves(l)).toEqual(['a', 'b', 'c'])
    expect(countLeaves(l)).toBe(3)
  })

  it('findLeaf locates a leaf node or returns null', () => {
    const l = split('h', leaf('a'), leaf('b'))
    expect(findLeaf(l, 'b')).toEqual(leaf('b'))
    expect(findLeaf(l, 'z')).toBeNull()
  })
})

describe('splitLeaf', () => {
  it('splits a lone leaf into a dir split, new leaf after by default', () => {
    const l = leaf('a')
    const next = splitLeaf(l, 'a', 'h', 'b')
    expect(next).toEqual(split('h', leaf('a'), leaf('b')))
  })

  it('side "before" puts the new leaf first', () => {
    const next = splitLeaf(leaf('a'), 'a', 'v', 'b', 'before')
    expect(next).toEqual(split('v', leaf('b'), leaf('a')))
  })

  it('splits a leaf nested inside an existing tree, leaving the rest untouched', () => {
    const l = split('h', leaf('a'), leaf('b'))
    const next = splitLeaf(l, 'b', 'v', 'c')
    expect(next).toEqual(split('h', leaf('a'), split('v', leaf('b'), leaf('c'))))
    // untouched branch keeps its reference
    expect((next as Extract<Layout, { type: 'split' }>).a).toBe((l as Extract<Layout, { type: 'split' }>).a)
  })

  it('no-ops (same reference) when leafId is not found', () => {
    const l = split('h', leaf('a'), leaf('b'))
    expect(splitLeaf(l, 'nope', 'h', 'c')).toBe(l)
  })

  it('no-ops when the new id is already present anywhere in the tree', () => {
    const l = split('h', leaf('a'), leaf('b'))
    expect(splitLeaf(l, 'a', 'h', 'b')).toBe(l)
  })

  it('no-ops on a null layout', () => {
    expect(splitLeaf(null, 'a', 'h', 'b')).toBeNull()
  })

  it('refuses to split past MAX_PANES leaves', () => {
    let l: Layout = leaf('t0')
    for (let i = 1; i < MAX_PANES; i++) {
      l = splitLeaf(l, `t${i - 1}`, 'h', `t${i}`)!
    }
    expect(countLeaves(l)).toBe(MAX_PANES)
    const blocked = splitLeaf(l, 't0', 'h', 'overflow')
    expect(blocked).toBe(l)
    expect(countLeaves(blocked)).toBe(MAX_PANES)
  })
})

describe('chainSize', () => {
  it('is 1 when the leaf is the whole tree (a fresh chain is about to start)', () => {
    expect(chainSize(leaf('a'), 'a', 'h')).toBe(1)
  })

  it('is 1 when the immediate parent splits the other direction', () => {
    const l = split('v', leaf('a'), leaf('b'))
    expect(chainSize(l, 'a', 'h')).toBe(1)
  })

  it('counts every leaf in the existing same-direction chain', () => {
    const l = split('h', leaf('a'), split('h', leaf('b'), leaf('c')))
    expect(chainSize(l, 'a', 'h')).toBe(3)
    expect(chainSize(l, 'c', 'h')).toBe(3)
  })

  it('stops at a differently-directed ancestor', () => {
    const l = split('v', split('h', leaf('a'), leaf('b')), leaf('c'))
    expect(chainSize(l, 'a', 'h')).toBe(2)
  })

  it('is 0 when the leaf is not found', () => {
    expect(chainSize(leaf('a'), 'z', 'h')).toBe(0)
    expect(chainSize(null, 'a', 'h')).toBe(0)
  })
})

describe('rebalanceChain', () => {
  it('no-ops on a null layout or when the leaf is the root', () => {
    expect(rebalanceChain(null, 'a')).toBeNull()
    expect(rebalanceChain(leaf('a'), 'a')).toEqual(leaf('a'))
  })

  it('flattens repeated halving into an even n-way chain (the reported "slivers" bug)', () => {
    // a(50%) | (b(50%) | (c(25%) | d(25%))) — split-split-split down one side, as ⌘D repeatedly
    // on the rightmost pane produces without rebalancing.
    let l: Layout = split('h', leaf('a'), split('h', leaf('b'), split('h', leaf('c'), leaf('d'), 0.5), 0.5), 0.5)
    const next = rebalanceChain(l, 'd')!
    expect(leaves(next)).toEqual(['a', 'b', 'c', 'd'])
    // every leaf in the chain now gets an equal quarter
    function ratios(node: Layout, acc: number[]): void {
      if (node.type === 'leaf') return
      acc.push(node.ratio)
      ratios(node.a, acc)
      ratios(node.b, acc)
    }
    const seen: number[] = []
    ratios(next, seen)
    expect(seen).toEqual([0.25, 1 / 3, 0.5])
  })

  it('only rebalances the contiguous same-direction run, leaving a different-direction subtree untouched', () => {
    const untouchedBranch: Layout = split('v', leaf('c'), leaf('d'), 0.3)
    const l = split('h', leaf('a'), untouchedBranch)
    const next = rebalanceChain(l, 'a')! as Extract<Layout, { type: 'split' }>
    expect(next.b).toBe(untouchedBranch) // reference preserved, not touched
  })

  it('is a no-op (same reference) when the chain is already balanced', () => {
    const l = split('h', leaf('a'), split('h', leaf('b'), leaf('c'), 0.5), 1 / 3)
    expect(rebalanceChain(l, 'a')).toEqual(l)
  })
})

describe('removeLeaf', () => {
  it('removing the only leaf yields null', () => {
    expect(removeLeaf(leaf('a'), 'a')).toBeNull()
  })

  it('removing one side collapses the split to its sibling', () => {
    const l = split('h', leaf('a'), leaf('b'))
    expect(removeLeaf(l, 'a')).toEqual(leaf('b'))
    expect(removeLeaf(l, 'b')).toEqual(leaf('a'))
  })

  it('removes a nested leaf, collapsing only its immediate parent', () => {
    const l = split('h', leaf('a'), split('v', leaf('b'), leaf('c')))
    expect(removeLeaf(l, 'b')).toEqual(split('h', leaf('a'), leaf('c')))
  })

  it('no-ops (same reference) when leafId is not found', () => {
    const l = split('h', leaf('a'), leaf('b'))
    expect(removeLeaf(l, 'z')).toBe(l)
  })

  it('no-ops on a null layout', () => {
    expect(removeLeaf(null, 'a')).toBeNull()
  })
})

describe('replaceLeaf', () => {
  it('swaps the terminal id at a leaf in place', () => {
    const l = split('h', leaf('a'), leaf('b'))
    expect(replaceLeaf(l, 'b', 'c')).toEqual(split('h', leaf('a'), leaf('c')))
  })

  it('no-ops when leafId is not found', () => {
    const l = leaf('a')
    expect(replaceLeaf(l, 'z', 'b')).toBe(l)
  })
})

describe('setRatio', () => {
  it('sets the root ratio via an empty path', () => {
    const l = split('h', leaf('a'), leaf('b'))
    expect(setRatio(l, [], 0.3)).toEqual(split('h', leaf('a'), leaf('b'), 0.3))
  })

  it('clamps to [0.12, 0.88]', () => {
    const l = split('h', leaf('a'), leaf('b'))
    expect((setRatio(l, [], -1) as Extract<Layout, { type: 'split' }>).ratio).toBe(0.12)
    expect((setRatio(l, [], 5) as Extract<Layout, { type: 'split' }>).ratio).toBe(0.88)
  })

  it('navigates a path to set a nested split ratio', () => {
    const l = split('h', leaf('a'), split('v', leaf('b'), leaf('c')))
    const path: PathStep[] = ['b']
    const next = setRatio(l, path, 0.7) as Extract<Layout, { type: 'split' }>
    expect((next.b as Extract<Layout, { type: 'split' }>).ratio).toBe(0.7)
    expect(next.a).toBe((l as Extract<Layout, { type: 'split' }>).a) // untouched branch keeps identity
  })

  it('no-ops on a leaf or null', () => {
    expect(setRatio(leaf('a'), [], 0.7)).toEqual(leaf('a'))
    expect(setRatio(null, [], 0.7)).toBeNull()
  })
})

describe('swapLeaves', () => {
  it('swaps two leaves within the same tree in one pass', () => {
    const l = split('h', leaf('a'), split('v', leaf('b'), leaf('c')))
    expect(swapLeaves(l, 'a', 'c')).toEqual(split('h', leaf('c'), split('v', leaf('b'), leaf('a'))))
  })

  it('no-ops (same reference) when the ids are equal', () => {
    const l = split('h', leaf('a'), leaf('b'))
    expect(swapLeaves(l, 'a', 'a')).toBe(l)
  })

  it('no-ops on a null layout', () => {
    expect(swapLeaves(null, 'a', 'b')).toBeNull()
  })

  it('leaves the tree unchanged (same reference) when neither id is present', () => {
    const l = split('h', leaf('a'), leaf('b'))
    expect(swapLeaves(l, 'x', 'y')).toBe(l)
  })
})

describe('gridDims', () => {
  it('picks a wide-favoring grid for each count up to MAX_PANES', () => {
    expect(gridDims(1)).toEqual([1, 1])
    expect(gridDims(2)).toEqual([2, 1])
    expect(gridDims(3)).toEqual([3, 1])
    expect(gridDims(4)).toEqual([2, 2])
    expect(gridDims(5)).toEqual([3, 2])
    expect(gridDims(6)).toEqual([3, 2])
    expect(gridDims(7)).toEqual([3, 3])
    expect(gridDims(8)).toEqual([3, 3])
    expect(gridDims(9)).toEqual([3, 3])
  })
})

describe('buildGrid', () => {
  it('null for empty, a bare leaf for one id', () => {
    expect(buildGrid([])).toBeNull()
    expect(buildGrid(['a'])).toEqual(leaf('a'))
  })

  it('every id ends up in the tree exactly once, order preserved row-major', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const grid = buildGrid(ids)
    expect(leaves(grid)).toEqual(ids)
  })

  it('builds an even 2x2 for 4 panes', () => {
    const grid = buildGrid(['a', 'b', 'c', 'd'])
    // 2 rows of 2, each row and each column split 50/50
    expect(grid).toEqual(
      split('v', split('h', leaf('a'), leaf('b'), 0.5), split('h', leaf('c'), leaf('d'), 0.5), 0.5)
    )
  })

  it('gives every leaf an equal ratio within its row/column for an uneven count', () => {
    const grid = buildGrid(['a', 'b', 'c', 'd', 'e']) // 3x2 dims, rows of 3 and 2
    expect(countLeaves(grid)).toBe(5)
    // row split: 3 vs 2 -> outer 'v' ratio is 1/2 (2 rows)
    const outer = grid as Extract<Layout, { type: 'split' }>
    expect(outer.dir).toBe('v')
    expect(outer.ratio).toBe(0.5)
    expect(leaves(outer.a)).toEqual(['a', 'b', 'c'])
    expect(leaves(outer.b)).toEqual(['d', 'e'])
  })

  it('caps out cleanly at MAX_PANES', () => {
    const ids = Array.from({ length: MAX_PANES }, (_, i) => `t${i}`)
    const grid = buildGrid(ids)
    expect(countLeaves(grid)).toBe(MAX_PANES)
    expect(leaves(grid)).toEqual(ids)
  })
})

