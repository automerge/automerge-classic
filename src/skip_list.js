const { Map } = require('immutable')

// Returns a random number from the geometric distribution with p = 0.75.
// That is, returns k with probability p * (1 - p)^(k - 1).
// For example, returns 1 with probability 3/4, returns 2 with probability 3/16,
// returns 3 with probability 3/64, and so on.
function* randomLevel() {
  while (true) {
    const rand = Math.floor(Math.random() * 4294967296)
    let level = 1
    while (rand < 1 << (32 - 2 * level) && level < 16) level += 1
    yield level
  }
}

class Node {
  constructor (key, value, level, prevKey, nextKey, prevCount, nextCount) {
    this.key = key
    this.value = value
    this.level = level
    this.prevKey = Object.freeze(prevKey)
    this.nextKey = Object.freeze(nextKey)
    this.prevCount = Object.freeze(prevCount)
    this.nextCount = Object.freeze(nextCount)
    Object.freeze(this)
  }

  insertAfter (newKey, newLevel, fromLevel, distance) {
    if (newLevel > this.level && this.key !== null) {
      throw new RangeError('Cannot increase the level of a non-head node')
    }
    const maxLevel = Math.max(this.level, newLevel)
    const nextKey = this.nextKey.slice()
    const nextCount = this.nextCount.slice()

    for (let level = fromLevel; level < maxLevel; level++) {
      if (level < newLevel) {
        nextKey[level] = newKey
        nextCount[level] = distance
      } else {
        nextCount[level] += 1
      }
    }

    return new Node(this.key, this.value, maxLevel,
                    this.prevKey, nextKey, this.prevCount, nextCount)
  }

  insertBefore (newKey, newLevel, fromLevel, distance) {
    if (newLevel > this.level) throw new RangeError('Cannot increase node level')
    const prevKey = this.prevKey.slice()
    const prevCount = this.prevCount.slice()

    for (let level = fromLevel; level < this.level; level++) {
      if (level < newLevel) {
        prevKey[level] = newKey
        prevCount[level] = distance
      } else {
        prevCount[level] += 1
      }
    }

    return new Node(this.key, this.value, this.level,
                    prevKey, this.nextKey, prevCount, this.nextCount)
  }
}

class SkipList {
  constructor (randomSource) {
    const head = new Node(null, null, 1, [], [null], [], [null])
    const random = randomSource ? randomSource() : randomLevel()
    return makeInstance(Map().set(null, head), random)
  }

  get headNode () {
    return this._nodes.get(null)
  }

  predecessors (predecessor, maxLevel) {
    const preKeys = [predecessor], preCounts = [1]

    for (let level = 1; level < maxLevel; level++) {
      let preKey = preKeys[level - 1]
      let count = preCounts[level - 1]
      while (preKey) {
        let node = this._nodes.get(preKey)
        if (node.level > level) break
        if (node.level < level) {
          throw new RangeError('Node ' + preKey + ' below expected level ' + (level - 1))
        }
        count += node.prevCount[level - 1]
        preKey = node.prevKey[level - 1]
      }
      preKeys[level] = preKey
      preCounts[level] = count
    }

    return {preKeys, preCounts}
  }

  successors (successor, maxLevel) {
    const sucKeys = [successor], sucCounts = [1]

    for (let level = 1; level < maxLevel; level++) {
      let sucKey = sucKeys[level - 1]
      let count = sucCounts[level - 1]
      while (sucKey) {
        let node = this._nodes.get(sucKey)
        if (node.level > level) break
        if (node.level < level) {
          throw new RangeError('Node ' + sucKey + ' below expected level ' + (level - 1))
        }
        count += node.nextCount[level - 1]
        sucKey = node.nextKey[level - 1]
      }
      sucKeys[level] = sucKey
      sucCounts[level] = count
    }

    return {sucKeys, sucCounts}
  }

  // Inserts a new list element immediately after the element with key `predecessor`.
  // If predecessor === null, inserts at the head of the list.
  insertAfter (predecessor, key, value) {
    if (!this._nodes.has(predecessor)) {
      throw new RangeError('The referenced predecessor key does not exist')
    }
    if (this._nodes.has(key)) {
      throw new RangeError('Cannot insert a key that already exists')
    }

    const newLevel = this._randomSource.next().value
    const maxLevel = Math.max(newLevel, this.headNode.level)
    const successor = this._nodes.get(predecessor).nextKey[0] || null
    const { preKeys, preCounts } = this.predecessors(predecessor, maxLevel)
    const { sucKeys, sucCounts } = this.successors(successor, maxLevel)

    return makeInstance(this._nodes.withMutations(nodes => {
      let preLevel = 0, sucLevel = 0
      for (let level = 1; level <= maxLevel; level++) {
        const updateLevel = Math.min(level, newLevel)
        if (level === maxLevel || preKeys[level] !== preKeys[preLevel]) {
          nodes.update(preKeys[preLevel],
                       node => node.insertAfter(key, updateLevel, preLevel, preCounts[preLevel]))
          preLevel = level
        }
        if (sucKeys[sucLevel] && (level === maxLevel || sucKeys[level] !== sucKeys[sucLevel])) {
          nodes.update(sucKeys[sucLevel],
                       node => node.insertBefore(key, updateLevel, sucLevel, sucCounts[sucLevel]))
          sucLevel = level
        }
      }

      nodes.set(key, new Node(key, value, newLevel,
                              preKeys.slice(0, newLevel),
                              sucKeys.slice(0, newLevel),
                              preCounts.slice(0, newLevel),
                              sucCounts.slice(0, newLevel)))
    }), this._randomSource)
  }
}

function makeInstance(nodes, randomSource) {
  const instance = Object.create(SkipList.prototype)
  instance._nodes = nodes
  instance._randomSource = randomSource
  return instance
}

module.exports = {SkipList}
