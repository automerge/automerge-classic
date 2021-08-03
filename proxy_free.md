# Proxy Free API
Automerge uses JS Proxy extensively for its front-end API. However, to be able to support multiple JS runtime which does not support `Proxy` you can use the **Proxy Free API**.

This API does not modify the way automerge handles conflict or nested objects. It is only modifies the `Object` and `Array` APIs.


## Getting starting
To use the Proxy Free API, you will only need to change a flag by calling `Automerge.useProxyFreeAPI()`. 


## Getters and Setters
The main difference between the current API and the Proxy Free API is that the latest one doesn't have property accessors. So, it is not possible to access to an automerge proxy free object's properties by using the bracket notation `value = doc[key]` and `doc[key] = value`. Instead, you can use the `set` and `get` methods. For example, `doc.set(key, value)` and `value = doc.get(key)`.

 Proxy API:
 ``` js
 Automerge.change(Automerge.init(), doc => {
    doc.key1 = 'value1'
    assert.strictEqual(doc.key1, 'value1')
  })
 ```

 Free Proxy API:
 ```js
 Automerge.change(Automerge.init(), doc => {
    doc.set('key1', 'value1')
    assert.strictEqual(doc.get('key1'), 'value1')
  })
 ```


## `Object` static methods 
It is not possible to use `Object` static methods.
### Changes:
  ```js
  Object.getOwnPropertyNames(doc) -> doc.getOwnPropertyNames()
  Object.ownKeys(doc) -> doc.ownKeys()
  Object.assign(doc) -> doc.assign()
  Object.getOwnPropertyNames(doc) -> doc.getOwnPropertyNames()
  ```

## `Array` static methods 
As with `Object` static methods it is not possible to use `Array` static methods.
### Changes:
  ```js
  // doc: { list: [1, 2, 3] }
  Array.isArray(doc.lis) -> doc.get('list').isArray()
  ```

## Standard Array Read-Only Operations
Standard array read-only operations works the same as the current API.
  ```js
  .concat()
  .entries()
  .every()
  .filter()
  .find()
  .findIndex()
  .forEach()
  .includes()
  .indexOf()
  .indexOf()
  .join()
  .keys()
  .lastIndexOf()
  .map()
  .reduce()
  .reduceRight()
  .slice()
  .some()
  .toString()
  .values()
  .pop()
  .push()
  .shift()
  .splice()
  .unshift()
  ```

The array proxy also allows mutation of objects returned from readonly list methods:
``` js
root = Automerge.change(Automerge.init({freeze: true}), doc => {
  doc.set('objects', [{id: 1, value: 'one'}, {id: 2, value: 'two'}])
})
root = Automerge.change(root, doc => {
  doc.get('objects').find(obj => obj.get('id') === 1).set('value', 'ONE!')
})
// root: {objects: [{id: 1, value: 'ONE!'}, {id: 2, value: 'two'}]}
``` 
and supports standard mutation methods:
```js
// doc: { list: [1, 2, 3] }
root = Automerge.change(root, doc => doc.get('list').fill('a'))
// doc: { list: ['a', 'a', 'a'] }
```

## Minor changes on Array Proxy
# `len` property
```js
doc.list.length -> doc.get('list').length()
```

# `in` operator
```js
0 in doc.list.length -> doc.get('list').has(0)
```
