<img src='./img/sign.svg' width='500' alt='Automerge logo' />

💬 [Join the Automerge Slack community](https://join.slack.com/t/automerge/shared_invite/zt-e4p3760n-kKh7r3KRH1YwwNfiZM8ktw)

[![Build Status](https://github.com/automerge/automerge/actions/workflows/automerge-ci.yml/badge.svg)](https://github.com/automerge/automerge/actions/workflows/automerge-ci.yml)
[![Browser Test Status](https://app.saucelabs.com/buildstatus/automerge)](https://app.saucelabs.com/open_sauce/user/automerge/builds)

Automerge is a library of data structures for building collaborative applications in JavaScript.

Please see [automerge.org](http://automerge.org/) for documentation.

## Setup

If you're using npm, `npm install automerge`. If you're using yarn, `yarn add automerge`. Then you
can import it with `require('automerge')` as in [the example below](#usage) (or
`import * as Automerge from 'automerge'` if using ES2015 or TypeScript).

Otherwise, clone this repository, and then you can use the following commands:

- `yarn install` — installs dependencies.
- `yarn test` — runs the test suite in Node.
- `yarn run browsertest` — runs the test suite in web browsers.
- `yarn build` — creates a bundled JS file `dist/automerge.js` for web browsers. It includes the
  dependencies and is set up so that you can load through a script tag.

## Meta

Copyright 2017–2021, the Automerge contributors. Released under the terms of the
MIT license (see `LICENSE`).
