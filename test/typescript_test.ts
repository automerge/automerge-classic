import * as assert from 'assert'
import uuid from 'uuid'
import * as Automerge from 'automerge'
import { Backend, Frontend } from 'automerge'

const UUID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const ROOT_ID = '00000000-0000-0000-0000-000000000000'

interface BirdList {
  birds: Automerge.List<string>
}

interface NumberBox {
  number: number
}

describe('TypeScript support', () => {
  describe('Automerge.init()', () => {
    it('should allow a document to be `any`', () => {
      let s1: any = Automerge.init()
      s1 = Automerge.change(s1, doc => doc.key = 'value')
      assert.strictEqual(s1.key, 'value')
      assert.strictEqual(s1.nonexistent, undefined)
      assert.deepEqual(s1, {key: 'value'})
    })

    it('should allow a document type to be specified', () => {
      let s1 = Automerge.init<BirdList>()
      assert.strictEqual(s1.birds, undefined)
      s1 = Automerge.change(s1, doc => doc.birds = ['goldfinch'])
      assert.strictEqual(s1.birds[0], 'goldfinch')
      assert.deepEqual(s1, {birds: ['goldfinch']})
    })

    it('should allow the actorId to be configured', () => {
      let s1: BirdList = Automerge.init<BirdList>('actor1')
      assert.strictEqual(Automerge.getActorId(s1), 'actor1')
      let s2 = Automerge.init<BirdList>()
      assert.strictEqual(UUID_PATTERN.test(Automerge.getActorId(s2)), true)
    })

    it('should allow a frontend to be `any`', () => {
      const s0: any = Frontend.init()
      const [s1, req1] = Frontend.change(s0, doc => doc.key = 'value')
      assert.strictEqual(s1.key, 'value')
      assert.strictEqual(s1.nonexistent, undefined)
      assert.strictEqual(UUID_PATTERN.test(Frontend.getActorId(s1)), true)
    })

    it('should allow a frontend type to be specified', () => {
      const s0 = Frontend.init<BirdList>()
      const [s1, req1] = Frontend.change(s0, doc => doc.birds = ['goldfinch'])
      assert.strictEqual(s1.birds[0], 'goldfinch')
      assert.deepEqual(s1, {birds: ['goldfinch']})
    })

    it('should allow a frontend actorId to be configured', () => {
      const s0: NumberBox = Frontend.init<NumberBox>('actor1')
      assert.strictEqual(Frontend.getActorId(s0), 'actor1')
    })

    it('should allow frontend actorId assignment to be deferred', () => {
      const s0 = Frontend.init<NumberBox>({deferActorId: true})
      assert.strictEqual(Frontend.getActorId(s0), undefined)
      const s1 = Frontend.setActorId(s0, uuid())
      const [s2, req] = Frontend.change(s1, doc => doc.number = 15)
      assert.deepEqual(s2, {number: 15})
    })
  })

  describe('saving and loading', () => {
    it('should allow an `any` type document to be loaded', () => {
      let s1: any = Automerge.init()
      s1 = Automerge.change(s1, doc => doc.key = 'value')
      let s2: any = Automerge.load(Automerge.save(s1))
      assert.strictEqual(s2.key, 'value')
      assert.deepEqual(s2, {key: 'value'})
    })

    it('should allow a document of declared type to be loaded', () => {
      let s1 = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, doc => doc.birds = ['goldfinch'])
      let s2 = Automerge.load<BirdList>(Automerge.save(s1))
      assert.strictEqual(s2.birds[0], 'goldfinch')
      assert.deepEqual(s2, {birds: ['goldfinch']})
      assert.strictEqual(UUID_PATTERN.test(Automerge.getActorId(s2)), true)
    })

    it('should allow the actorId to be configured', () => {
      let s1 = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, doc => doc.birds = ['goldfinch'])
      let s2 = Automerge.load<BirdList>(Automerge.save(s1), 'actor1')
      assert.strictEqual(Automerge.getActorId(s2), 'actor1')
    })
  })

  describe('making changes', () => {
    it('should accept an optional message', () => {
      let s1: BirdList = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, 'hello', doc => doc.birds = [])
      assert.strictEqual(Automerge.getHistory(s1)[0].change.message, 'hello')
    })

    it('should support list modifications', () => {
      let s1: BirdList = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, doc => doc.birds = ['goldfinch'])
      s1 = Automerge.change(s1, doc => {
        doc.birds.insertAt(1, 'greenfinch', 'bullfinch', 'chaffinch')
        doc.birds.deleteAt(0)
        doc.birds.deleteAt(0, 2)
      })
      assert.deepEqual(s1, {birds: ['chaffinch']})
    })

    it('should allow empty changes', () => {
      let s1 = Automerge.init()
      s1 = Automerge.emptyChange(s1, 'my message')
      assert.strictEqual(Automerge.getHistory(s1)[0].change.message, 'my message')
    })

    it('should allow inspection of conflicts', () => {
      let s1 = Automerge.init<NumberBox>('actor1')
      s1 = Automerge.change(s1, doc => doc.number = 3)
      let s2 = Automerge.init<NumberBox>('actor2')
      s2 = Automerge.change(s2, doc => doc.number = 42)
      let s3 = Automerge.merge(s1, s2)
      assert.strictEqual(s3.number, 42)
      assert.deepEqual(Automerge.getConflicts(s3, 'number'), {actor1: 3})
    })

    it('should allow changes in the frontend', () => {
      const s0 = Frontend.init<BirdList>()
      const [s1, req1] = Frontend.change(s0, doc => doc.birds = ['goldfinch'])
      const [s2, req2] = Frontend.change(s1, doc => doc.birds.push('chaffinch'))
      assert.strictEqual(s2.birds[1], 'chaffinch')
      assert.deepEqual(s2, {birds: ['goldfinch', 'chaffinch']})
      assert.strictEqual(req2.message, undefined)
      assert.strictEqual(req2.actor, Frontend.getActorId(s0))
      assert.strictEqual(req2.seq, 2)
    })

    it('should accept a message in the frontend', () => {
      const s0 = Frontend.init<NumberBox>()
      const [s1, req1] = Frontend.change(s0, 'test message', doc => doc.number = 1)
      assert.strictEqual(req1.message, 'test message')
      assert.strictEqual(req1.actor, Frontend.getActorId(s0))
      assert.strictEqual(req1.ops.length, 1)
    })

    it('should allow empty changes in the frontend', () => {
      const s0 = Frontend.init<NumberBox>()
      const [s1, req1] = Frontend.emptyChange(s0, 'nothing happened')
      assert.strictEqual(req1.message, 'nothing happened')
      assert.strictEqual(req1.actor, Frontend.getActorId(s0))
      assert.strictEqual(req1.ops.length, 0)
    })

    it('should work with split frontend and backend', () => {
      const s0 = Frontend.init<NumberBox>(), b0 = Backend.init<NumberBox>()
      const [s1, req1] = Frontend.change(s0, doc => doc.number = 1)
      const [b1, patch1] = Backend.applyLocalChange(b0, req1)
      const s2 = Frontend.applyPatch(s1, patch1)
      assert.strictEqual(s2.number, 1)
      assert.strictEqual(patch1.actor, Automerge.getActorId(s0))
      assert.strictEqual(patch1.seq, 1)
      assert.deepEqual(patch1.clock, {[Automerge.getActorId(s0)]: 1})
      assert.strictEqual(patch1.canUndo, true)
      assert.strictEqual(patch1.canRedo, false)
      assert.strictEqual(patch1.diffs.length, 1)
      assert.strictEqual(patch1.diffs[0].action, 'set')
      assert.strictEqual(patch1.diffs[0].type, 'map')
      assert.strictEqual(patch1.diffs[0].obj, ROOT_ID)
      assert.deepEqual(patch1.diffs[0].path, [])
      assert.strictEqual(patch1.diffs[0].key, 'number')
      assert.strictEqual(patch1.diffs[0].value, 1)
    })
  })

  describe('getting and applying changes', () => {
    it('should return an array of change objects', () => {
      let s1 = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, doc => doc.birds = ['goldfinch'])
      let s2 = Automerge.change(s1, 'add chaffinch', doc => doc.birds.push('chaffinch'))
      const changes = Automerge.getChanges(s1, s2)
      assert.strictEqual(changes.length, 1)
      assert.strictEqual(changes[0].message, 'add chaffinch')
      assert.strictEqual(changes[0].actor, Automerge.getActorId(s2))
      assert.strictEqual(changes[0].seq, 2)
    })

    it('should include operations in changes', () => {
      let s1 = Automerge.init<NumberBox>()
      s1 = Automerge.change(s1, doc => doc.number = 3)
      const changes = Automerge.getChanges(Automerge.init(), s1)
      assert.strictEqual(changes.length, 1)
      assert.strictEqual(changes[0].ops.length, 1)
      assert.strictEqual(changes[0].ops[0].action, 'set')
      assert.strictEqual(changes[0].ops[0].obj, ROOT_ID)
      assert.strictEqual(changes[0].ops[0].key, 'number')
      assert.strictEqual(changes[0].ops[0].value, 3)
    })

    it('should allow changes to be re-applied', () => {
      let s1 = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, doc => doc.birds = [])
      let s2 = Automerge.change(s1, doc => doc.birds.push('goldfinch'))
      const changes = Automerge.getChanges(Automerge.init<BirdList>(), s2)
      let s3 = Automerge.applyChanges(Automerge.init<BirdList>(), changes)
      assert.deepEqual(s3.birds, ['goldfinch'])
    })

    it('should allow concurrent changes to be merged', () => {
      let s1 = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, doc => doc.birds = ['goldfinch'])
      let s2 = Automerge.change(s1, doc => doc.birds.unshift('greenfinch'))
      let s3 = Automerge.merge(Automerge.init<BirdList>(), s1)
      s3 = Automerge.change(s3, doc => doc.birds.push('chaffinch'))
      let s4 = Automerge.merge(s2, s3)
      assert.deepEqual(s4.birds, ['greenfinch', 'goldfinch', 'chaffinch'])
    })
  })

  describe('undo and redo', () => {
    it('should undo field assignment', () => {
      let s1 = Automerge.change(Automerge.init<NumberBox>(), doc => doc.number = 3)
      s1 = Automerge.change(s1, doc => doc.number = 4)
      assert.strictEqual(s1.number, 4)
      assert.strictEqual(Automerge.canUndo(s1), true)
      s1 = Automerge.undo(s1)
      assert.strictEqual(s1.number, 3)
      assert.strictEqual(Automerge.canUndo(s1), true)
      s1 = Automerge.undo(s1)
      assert.strictEqual(s1.number, undefined)
      assert.strictEqual(Automerge.canUndo(s1), false)
    })

    it('should redo previous undos', () => {
      let s1 = Automerge.change(Automerge.init<NumberBox>(), doc => doc.number = 3)
      s1 = Automerge.change(s1, doc => doc.number = 4)
      assert.strictEqual(Automerge.canRedo(s1), false)
      s1 = Automerge.undo(s1)
      assert.strictEqual(s1.number, 3)
      assert.strictEqual(Automerge.canRedo(s1), true)
      s1 = Automerge.redo(s1)
      assert.strictEqual(s1.number, 4)
      assert.strictEqual(Automerge.canRedo(s1), false)
    })

    it('should allow an optional message on undos', () => {
      let s1 = Automerge.change(Automerge.init<NumberBox>(), doc => doc.number = 3)
      s1 = Automerge.change(s1, doc => doc.number = 4)
      s1 = Automerge.undo(s1, 'go back to 3')
      assert.strictEqual(Automerge.getHistory(s1).length, 3)
      assert.strictEqual(Automerge.getHistory(s1)[2].change.message, 'go back to 3')
      assert.deepEqual(s1, {number: 3})
    })

    it('should generate undo requests in the frontend', () => {
      const doc0 = Frontend.init<NumberBox>(), b0 = Backend.init()
      assert.strictEqual(Frontend.canUndo(doc0), false)
      const [doc1, req1] = Frontend.change(doc0, doc => doc.number = 1)
      const [b1, patch1] = Backend.applyLocalChange(b0, req1)
      const doc1a = Frontend.applyPatch(doc1, patch1)
      assert.strictEqual(Frontend.canUndo(doc1a), true)
      const [doc2, req2] = Frontend.undo(doc1a)
      assert.strictEqual(req2.requestType, 'undo')
      assert.strictEqual(req2.actor, Frontend.getActorId(doc0))
      assert.strictEqual(req2.seq, 2)
      const [b2, patch2] = Backend.applyLocalChange(b1, req2)
      const doc2a = Frontend.applyPatch(doc2, patch2)
      assert.deepEqual(doc2a, {})
    })
  })

  describe('history inspection', () => {
    it('should diff two document states', () => {
      const s1 = Automerge.change(Automerge.init<NumberBox>(), doc => doc.number = 1)
      const s2 = Automerge.change(s1, doc => doc.number = 2)
      const diff = Automerge.diff(s1, s2)
      assert.strictEqual(diff.length, 1)
      assert.strictEqual(diff[0].action, 'set')
      assert.strictEqual(diff[0].type, 'map')
      assert.strictEqual(diff[0].obj, ROOT_ID)
      assert.deepEqual(diff[0].path, [])
      assert.strictEqual(diff[0].key, 'number')
      assert.strictEqual(diff[0].value, 2)
    })

    it('should inspect document history', () => {
      const s0 = Automerge.init<NumberBox>()
      const s1 = Automerge.change(s0, 'one', doc => doc.number = 1)
      const s2 = Automerge.change(s1, 'two', doc => doc.number = 2)
      const history = Automerge.getHistory(s2)
      assert.strictEqual(history.length, 2)
      assert.strictEqual(history[0].change.message, 'one')
      assert.strictEqual(history[1].change.message, 'two')
      assert.strictEqual(history[0].snapshot.number, 1)
      assert.strictEqual(history[1].snapshot.number, 2)
    })
  })

  describe('state inspection', () => {
    it('should support looking up objects by ID', () => {
      const s0 = Automerge.init<BirdList>()
      const s1 = Automerge.change(s0, doc => doc.birds = ['goldfinch'])
      const obj = Automerge.getObjectId(s1.birds)
      assert.strictEqual(Automerge.getObjectById(s1, obj).length, 1)
      assert.strictEqual(Automerge.getObjectById(s1, obj), s1.birds)
    })
  })

  describe('Automerge.Text', () => {
    interface TextDoc {
      text: Automerge.Text
    }

    let doc: TextDoc

    beforeEach(() => {
      doc = Automerge.change<TextDoc>(Automerge.init(), doc => (doc.text = new Automerge.Text()))
    })

    describe('insertAt', () => {
      it('should support inserting a single element', () => {
        doc = Automerge.change(doc, doc => doc.text.insertAt(0, 'abc'))
        assert.strictEqual(JSON.stringify(doc.text), '"abc"')
      })

      it('should support inserting multiple elements', () => {
        doc = Automerge.change(doc, doc => doc.text.insertAt(0, 'a', 'b', 'c'))
        assert.strictEqual(JSON.stringify(doc.text), '"abc"')
      })
    })

    describe('deleteAt', () => {
      beforeEach(() => {
        doc = Automerge.change(doc, doc => doc.text.insertAt(0, 'a', 'b', 'c', 'd', 'e', 'f', 'g'))
      })

      it('should support deleting a single element without specifying `numDelete`', () => {
        doc = Automerge.change(doc, doc => doc.text.deleteAt(2))
        assert.strictEqual(JSON.stringify(doc.text), '"abdefg"')
      })

      it('should support deleting multiple elements', () => {
        doc = Automerge.change(doc, doc => doc.text.deleteAt(3, 2))
        assert.strictEqual(JSON.stringify(doc.text), '"abcfg"')
      })
  })

    describe('get', () => {
      it('should get the element at the given index', () => {
        doc = Automerge.change(doc, doc => doc.text.insertAt(0, 'a', 'b', 'cdefg', 'hi', 'jkl'))
        assert.strictEqual(doc.text.get(0), 'a')
        assert.strictEqual(doc.text.get(2), 'cdefg')
      })
    })

    describe('delegated read-only operations from `Array`', () => {
      const a = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
      beforeEach(() => {
        doc = Automerge.change(doc, doc => doc.text.insertAt(0, ...a))
  })

      it('supports `indexOf`', () => assert.strictEqual(doc.text.indexOf('c'), 2))
      it('supports `length`', () => assert.strictEqual(doc.text.length, 9))
      it('supports `concat`', () => assert.strictEqual(doc.text.concat(['j']).length, 10))
      it('supports `includes`', () => assert.strictEqual(doc.text.includes('q'), false))
    })
  })

  describe('Automerge.Table', () => {

  })

  describe('Automerge.Counter', () => {

  })
})
