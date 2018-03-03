## Text editing support

---
### Automerge document pages
* [Automerge synopsis](https://github.com/restarian/automerge/blob/brace_document/docs/automerge_synopsis.md)
* [Changelog](https://github.com/restarian/automerge/blob/brace_document/docs/changelog.md)
* [Conflicting changes](https://github.com/restarian/automerge/blob/brace_document/docs/conflicting_changes.md)
* [Document lifecycle](https://github.com/restarian/automerge/blob/brace_document/docs/document_lifecycle.md)
* [Examining document history](https://github.com/restarian/automerge/blob/brace_document/docs/examining_document_history.md)
* [Example usage](https://github.com/restarian/automerge/blob/brace_document/docs/example_usage.md)
* [Manipulating and inspecting data](https://github.com/restarian/automerge/blob/brace_document/docs/manipulating_and_inspecting_data.md)
* [Sending and receiving changes](https://github.com/restarian/automerge/blob/brace_document/docs/sending_and_receiving_changes.md)
* **Text editing support**
* Internal data structures
  * [Actor IDs, vector clocks and causality](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/actor_IDs,_vector_clocks_and_causality.md)
  * [Change structure and operation types](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/change_structure_and_operation_types.md)
  * [State, operations and deltas](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/state,_operations_and_deltas.md)

---

`Automerge.Text` provides experimental support for collaborative text editing.
Under the hood, text is represented as a list of characters, which is edited by inserting or
deleting individual characters. Compared to using a regular JavaScript array,
`Automerge.Text` offers better performance.

(Side note: technically, text should be represented as a list of
[Unicode *grapheme clusters*](http://www.unicode.org/reports/tr29/).
What the user thinks of as a "character" may actually be a series of several Unicode code points,
including accents, diacritics, and other combining marks. A grapheme cluster is the smallest
editable unit of text: that is, the thing that gets deleted if you press the delete key once, or the
thing that the cursor skips over if you press the right-arrow key once. Emoji make a good test case,
since many emoji consist of a sequence of several Unicode code points — for example, the
[skintone modifier](http://www.unicode.org/reports/tr51/) is a combining mark.)

You can create a Text object inside a change callback.
Then you can use `insertAt()` and `deleteAt()` to insert and delete characters (same API as for
list modifications, shown above):

```js
newDoc = Automerge.change(currentDoc, doc => {
  doc.text = new Automerge.Text()
  doc.text.insertAt(0, 'h', 'e', 'l', 'l', 'o')
  doc.text.deleteAt(0)
  doc.text.insertAt(0, 'H')
})
```

To inspect a text object and render it, you can use the following methods
(outside of a change callback):

```js
newDoc.text.length   // returns 5, the number of characters
newDoc.text.get(0)   // returns 'H', the 0th character in the text
newDoc.text.join('') // returns 'Hello', the concatenation of all characters
for (let char of newDoc.text) console.log(char) // iterates over all characters
```
