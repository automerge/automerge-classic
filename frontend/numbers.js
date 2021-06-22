// Convience classes to allow users to stricly specify the number type they want

class Int {
  constructor(value) {
    if (!(Number.isInteger(value) && value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER)) {
      throw new RangeError(`Value ${value} cannot be a uint`)
    }
    this.value = value
    Object.freeze(this)
  }
}

class Uint {
  constructor(value) {
    if (!(Number.isInteger(value) && value <= Number.MAX_SAFE_INTEGER && value >= 0)) {
      throw new RangeError(`Value ${value} cannot be a uint`)
    }
    this.value = value
    Object.freeze(this)
  }
}

class Float64 {
  constructor(value) {
    if (typeof value !== 'number') {
      throw new RangeError(`Value ${value} cannot be a float64`)
    }
    this.value = value || 0.0
    Object.freeze(this)
  }
}

module.exports = { Int, Uint, Float64 }
