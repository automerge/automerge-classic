
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

class Float32 {
  constructor(value) {
    if (!isNumber(value)) {
      throw new RangeError(`Value ${value} cannot be a float32`)
    }
    const buf32 = new ArrayBuffer(4), view32 = new DataView(buf32)
    view32.setFloat32(0, value, true)
    this.value = view32.getFloat32(0, true)
    Object.freeze(this)
  }
}


class Float64 {
  constructor(value) {
    if (!isNumber(value)) {
      throw new RangeError(`Value ${value} cannot be a float64`)
    }
    this.value = value || 0.0
    Object.freeze(this)
  }
}

function isNumber(value) {
  return typeof value === 'number'
}

function isInt(value) {
    return (Number.isInteger(value) && value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER)
}

module.exports = { Int, Uint, Float32, Float64 }
