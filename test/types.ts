import { Frontend } from 'automerge'

// Document types used by tests
export interface Foo {
  foo?: string
}

export interface BirdList {
  birds: List<string>
}

export interface BirdBox {
  bird?: string
}

export interface CountMap {
  [name: string]: number
}

export interface AnimalMap {
  birds: CountMap
  mammals?: CountMap
}

export interface CounterMap {
  [name: string]: Frontend.Counter
}

export interface CounterList {
  counts: Frontend.Counter[]
}

export interface BirdCounterMap {
  birds: CounterMap
}

export interface DateBox {
  now: Date
}

export interface NumberBox {
  number: number
}
