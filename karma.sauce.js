const path = require('path')
const webpack = require('webpack')
const webpackConfig = require("./webpack.config.js")

// Karma-Webpack needs these gone
delete webpackConfig.entry
delete webpackConfig.output.filename

// Don't mix dist/
webpackConfig.output.path = path.join(webpackConfig.output.path, 'test')

// You're importing *a lot* of Node-specific code so the bundle is huge...
webpackConfig.plugins = [
  new webpack.DefinePlugin({
    'process.env.TEST_DIST': JSON.stringify(process.env.TEST_DIST) || '1',
    'process.env.NODE_DEBUG': false,
  }),
  ...(webpackConfig.plugins || []),
]

module.exports = function(config) {
  if (!process.env.SAUCE_USERNAME || !process.env.SAUCE_ACCESS_KEY) {
    console.log('Make sure the SAUCE_USERNAME and SAUCE_ACCESS_KEY environment variables are set.') // eslint-disable-line
    process.exit(1)
  }

  // Browsers to run on Sauce Labs
  // Check out https://saucelabs.com/platforms for all browser/OS combos
  const customLaunchers = {
    sl_chrome: {
      base: 'SauceLabs',
      browserName: 'chrome',
      platform: 'Windows 10',
      version: 'latest'
    },
    sl_firefox: {
      base: 'SauceLabs',
      browserName: 'firefox',
      platform: 'Windows 10',
      version: 'latest'
    },
    sl_edge: {
      base: 'SauceLabs',
      browserName: 'MicrosoftEdge',
      platform: 'Windows 10',
      version: 'latest'
    },
    sl_safari_mac: {
      base: 'SauceLabs',
      browserName: 'safari',
      platform: 'macOS 10.15',
      version: 'latest'
    }
  }

  config.set({
    frameworks: ['webpack', 'mocha', 'karma-typescript'],
    files: [
      { pattern: 'test/*test*.js', watched: false },
      { pattern: 'test/*test*.ts' },
    ],
    preprocessors: {
      'test/*test*.js': ['webpack'],
      'test/*test*.ts': ['karma-typescript'],
    },
    webpack: webpackConfig,
    karmaTypescriptConfig: {
      tsconfig: './tsconfig.json',
      bundlerOptions: {
        resolve: {
          alias: { automerge: './src/automerge.js' }
        }
      },
      compilerOptions: {
        allowJs: true,
        sourceMap: true,
      }
    },
    port: 9876,
    captureTimeout: 120000,
    sauceLabs: {
      testName: 'Automerge unit tests',
      startConnect: false, // Sauce Connect is started in GitHub action
      tunnelIdentifier: 'github-action-tunnel'
    },
    customLaunchers,
    browsers: Object.keys(customLaunchers),
    reporters: ['progress', 'saucelabs'],
    singleRun: true
  })
}
