module.exports = function(config) {
  if (!process.env.SAUCE_USERNAME || !process.env.SAUCE_ACCESS_KEY) {
    console.log('Make sure the SAUCE_USERNAME and SAUCE_ACCESS_KEY environment variables are set.')
    process.exit(1)
  }

  // Browsers to run on Sauce Labs
  // Check out https://saucelabs.com/platforms for all browser/OS combos
  const customLaunchers = {
    sl_chrome: {
      base: 'SauceLabs',
      browserName: 'chrome',
      platform: 'Windows 10',
      version: '69.0'
    },
    sl_firefox: {
      base: 'SauceLabs',
      browserName: 'firefox',
      platform: 'Windows 10',
      version: '62.0'
    },
    sl_edge: {
      base: 'SauceLabs',
      browserName: 'MicrosoftEdge',
      platform: 'Windows 10',
      version: '17.17134'
    },
    sl_safari_mac: {
      base: 'SauceLabs',
      browserName: 'safari',
      platform: 'macOS 10.13',
      version: '11.1'
    }
  }

  config.set({
    frameworks: ['browserify', 'mocha', 'karma-typescript'],
    files: ['test/*.js', 'test/*.ts'],
    preprocessors: {
      'test/*.js': ['browserify'],
      'test/*.ts': ['karma-typescript']
    },
    karmaTypescriptConfig: {
      tsconfig: './tsconfig.json',
      compilerOptions: {
        sourceMap: true,
      }
    },
    browserify: {debug: true},
    port: 9876,
    captureTimeout: 120000,
    sauceLabs: {
      testName: 'Automerge unit tests',
      startConnect: false, // Sauce Connect is started via setting in .travis.yml
      tunnelIdentifier: process.env.TRAVIS_JOB_NUMBER
    },
    customLaunchers: customLaunchers,
    browsers: Object.keys(customLaunchers),
    reporters: ['progress', 'saucelabs'],
    singleRun: true
  })
}
