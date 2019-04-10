declare module 'skip_list' {

  class NodeData<T>  {
      key: string
      value: T
      level: number
      prevKey: string[]
      nextKey: string[]
      prevCount: number[]
      nextCount: number[]
  }

  class Node<T> extends NodeData<T> {
    constructor(
      key: string,
      value: T,
      level: number,
      prevKey: string,
      nextKey: string,
      prevCount: number,
      nextCount: number
    )

    setValue(key: string, value: T): Node<T>
    insertAfter(newKey: string, newLevel: number, fromLevel: number, distance: number): Node<T>
    insertBefore(newKey: string, newLevel: number, fromLevel: number, distance: number): Node<T>
    removeAfter(fromLevel: number, removedLevel: number, newKeys: string[], distances: number[]): Node<T>
    removeBefore(fromLevel: number, removedLevel: number, newKeys: string[], distances: number[]): Node<T>
  }

  type RandomGenerator = () => { next(): { value: number; done: boolean } }
  type IteratorMode = 'keys' | 'values' | 'entries'
  type IteratorResult<T> = {
    next(): {
      value: string | T | [string, T]
      done: boolean
    }
    [Symbol.iterator](): IteratorResult<T>
  }

  class SkipList<T> {
    _nodes: Map<string, T>
    _randomSource: RandomGenerator

    constructor(randomSource?: RandomGenerator)

    headNode: Node<T>
    length: number
    predecessors(predecessor: Node<T>, maxLevel: number): { preKeys: string[]; preCounts: number[] }
    successors(successor: Node<T>, maxLevel: number): { sucKeys: string[]; sucCounts: number[] }
    insertAfter(predecessor: string, key: string, value: T): SkipList<T>
    insertIndex(index: number, key: string, value: T): SkipList<T>
    removeKey(key: string): SkipList<T>
    removeIndex(index: number): SkipList<T>
    indexOf(key: string): number
    keyOf(index: number): string
    getValue(key: string): T
    setValue(key: string, value: T): SkipList<T>
    iterator(mode: IteratorMode): IteratorResult<T>
    [Symbol.iterator](): IteratorResult<T>
  }
}
