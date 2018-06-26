# Changelog

Automerge adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html) for assigning
version numbers.

All notable changes to Automerge will be documented in this file, which
is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.7.11] — 2018-06-26

### Fixed
- [#97]: `delete` operator no longer throws an exception if the property doesn't exist
  ([@salzhrani], [@EthanRBrown])
- [#104]: Fix an error when loading the webpack-packaged version of Automerge in Node.js ([@ept])

## [0.7.10] — 2018-06-12

### Added
- [#93]: Allow the UUID implementation to be replaced for testing purposes ([@kpruden])
- [#74]: Automerge.diff() now includes the path from the root to the modified object ([@ept])

## [0.7.9] — 2018-05-25

### Fixed
- [#90]: Compatibility with Node 10 ([@aslakhellesoy])

## [0.7.8] — 2018-05-15

### Fixed
- [#91]: Improve performance of changes that modify many list or map elements ([@ept])

## [0.7.7] — 2018-04-24

- [#87]: Remove babel-polyfill from transpiled library ([@EthanRBrown])

## 0.7.4, 0.7.5, [0.7.6] — 2018-04-19

- Version bump to fix a build tooling issue

## [0.7.3] — 2018-04-19

- [#85]: Publish Babel-transpiled code to npm to improve compatibility ([@EthanRBrown])

## [0.7.2] — 2018-04-17

### Changed
- [#83]: Changed `_objectId` property on Automerge map objects to be non-enumerable ([@EthanRBrown], [@ept])
- [#84]: Changed `_conflicts`, `_state`, and `_actorId` to be non-enumerable properties ([@ept])

### Fixed
- [#77]: Fixed exception when a list element is inserted and updated in the same change callback
  ([@mmcgrana], [@ept])
- [#78]: Better error message when trying to use an unsupported datatype ([@ept])


## [0.7.1] — 2018-02-26

### Fixed
- [#69]: `Automerge.load` generates random actorId if none specified ([@saranrapjs])
- [#64]: `Automerge.applyChanges()` allows changes to be applied out-of-order ([@jimpick], [@ept])


## [0.7.0] — 2018-01-15

### Added
- [#62]: Initial support for Immutable.js API compatibility (read-only for now) ([@ept], [@jeffpeterson])
- [#45]: Added experimental APIs `Automerge.getMissingDeps`, `Automerge.getChangesForActor`, and
  `Automerge.WatchableDoc` to support integration with dat hypercore ([@pvh], [@ept])
- [#46]: Automerge list objects now also have a `_conflicts` property that records concurrent
  assignments to the same list index, just like map objects have had all along ([@ept])

### Changed
- [#60]: `splice` in an `Automerge.change()` callback returns an array of deleted elements (to match behaviour of
  [`Array#splice`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/splice)).
  ([@aslakhellesoy])

### Fixed
- [#57]: Tests now work on operating systems with case-sensitive filesystems ([@mmmm1998])


## [0.6.0] — 2017-12-13

### Added
- [#44]: New APIs `Automerge.getChanges` and `Automerge.applyChanges` to provide more flexibility for
  network protocol layer ([@ept])
- [#41]: New `Automerge.Text` datatype, which is more efficient than a list for character-by-character
  editing of text ([@ept])
- [#40]: Lists are now backed by a new indexed skip list data structure, which is faster ([@ept])

### Changed
- [#38]: To save memory, `Automerge.getHistory` now builds snapshots of past states only when
  requested, rather than remembering them by default ([@ept])


## [0.5.0] — 2017-09-19

### Added
- [#37]: Added `Automerge.diff` to find the differences between to Automerge documents ([@ept])
- [#37]: Added support for incremental cache maintenance, bringing a 20x speedup for a 1,000-element list ([@ept])
- [#36]: Added `Automerge.Connection` and `Automerge.DocSet` classes to support peer-to-peer
  network protocols ([@ept], [@pvh])

### Changed
- Renamed `Automerge.changeset` to `Automerge.change` ([@ept])


## [0.4.3] — 2017-08-16

### Fixed
- [#34]: Fixed a bug that caused list elements to sometimes disappear ([@aslakhellesoy], [@ept])
- [#32]: Fixed a test failure in recent Node.js versions ([@aslakhellesoy])


## [0.4.2] — 2017-06-29

### Added
- Set up Karma to run tests in web browsers ([@ept])
- Set up Webpack to produce bundled JavaScript file for web browsers ([@ept])


## [0.4.1] — 2017-06-26

### Changed
- `Automerge.getHistory` API now uses the object cache, which should be faster ([@ept])


## [0.4.0] — 2017-06-23

### Changed
- Automerge documents are now just regular JavaScript objects, and Proxy is used only within
  `Automerge.changeset` callbacks. Previously everything used Proxy. ([@ept])
- [#30]: Made `_objectId` an enumerable property, so that it is visible by default ([@ept])
- Support all standard JavaScript array methods and iterators on list proxy object ([@ept])


## [0.3.0] — 2017-06-13

- First public release.


[Unreleased]: https://github.com/automerge/automerge/compare/v0.7.11...HEAD
[0.7.11]: https://github.com/automerge/automerge/compare/v0.7.10...v0.7.11
[0.7.10]: https://github.com/automerge/automerge/compare/v0.7.9...v0.7.10
[0.7.9]: https://github.com/automerge/automerge/compare/v0.7.8...v0.7.9
[0.7.8]: https://github.com/automerge/automerge/compare/v0.7.7...v0.7.8
[0.7.7]: https://github.com/automerge/automerge/compare/v0.7.6...v0.7.7
[0.7.6]: https://github.com/automerge/automerge/compare/v0.7.3...v0.7.6
[0.7.3]: https://github.com/automerge/automerge/compare/v0.7.2...v0.7.3
[0.7.2]: https://github.com/automerge/automerge/compare/v0.7.1...v0.7.2
[0.7.1]: https://github.com/automerge/automerge/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/automerge/automerge/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/automerge/automerge/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/automerge/automerge/compare/v0.4.3...v0.5.0
[0.4.3]: https://github.com/automerge/automerge/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/automerge/automerge/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/automerge/automerge/compare/v0.4.0...v0.4.2
[0.4.0]: https://github.com/automerge/automerge/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/automerge/automerge/compare/v0.2.0...v0.3.0

[#104]: https://github.com/automerge/automerge/issues/104
[#97]: https://github.com/automerge/automerge/issues/97
[#93]: https://github.com/automerge/automerge/pull/93
[#91]: https://github.com/automerge/automerge/pull/91
[#90]: https://github.com/automerge/automerge/pull/90
[#87]: https://github.com/automerge/automerge/pull/87
[#85]: https://github.com/automerge/automerge/pull/85
[#84]: https://github.com/automerge/automerge/pull/84
[#83]: https://github.com/automerge/automerge/pull/83
[#78]: https://github.com/automerge/automerge/issues/78
[#77]: https://github.com/automerge/automerge/pull/77
[#74]: https://github.com/automerge/automerge/pull/74
[#69]: https://github.com/automerge/automerge/pull/69
[#64]: https://github.com/automerge/automerge/pull/64
[#62]: https://github.com/automerge/automerge/pull/62
[#60]: https://github.com/automerge/automerge/pull/60
[#57]: https://github.com/automerge/automerge/pull/57
[#46]: https://github.com/automerge/automerge/issues/46
[#45]: https://github.com/automerge/automerge/pull/45
[#44]: https://github.com/automerge/automerge/pull/44
[#41]: https://github.com/automerge/automerge/pull/41
[#40]: https://github.com/automerge/automerge/pull/40
[#38]: https://github.com/automerge/automerge/issues/38
[#37]: https://github.com/automerge/automerge/pull/37
[#36]: https://github.com/automerge/automerge/pull/36
[#34]: https://github.com/automerge/automerge/pull/34
[#32]: https://github.com/automerge/automerge/pull/32
[#30]: https://github.com/automerge/automerge/pull/30

[@aslakhellesoy]: https://github.com/aslakhellesoy
[@EthanRBrown]: https://github.com/EthanRBrown
[@jeffpeterson]: https://github.com/jeffpeterson
[@jimpick]: https://github.com/jimpick
[@ept]: https://github.com/ept
[@kpruden]: https://github.com/kpruden
[@mmcgrana]: https://github.com/mmcgrana
[@mmmm1998]: https://github.com/mmmm1998
[@pvh]: https://github.com/pvh
[@salzhrani]: https://github.com/salzhrani
[@saranrapjs]: https://github.com/saranrapjs
