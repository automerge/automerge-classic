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
      version: '65.0'
    },
    sl_firefox: {
      base: 'SauceLabs',
      browserName: 'firefox',
      platform: 'Windows 10',
      version: '59.0'
    },
    sl_edge: {
      base: 'SauceLabs',
      browserName: 'MicrosoftEdge',
      platform: 'Windows 10',
      version: '16.16299'
    },
    sl_safari_mac: {
      base: 'SauceLabs',
      browserName: 'safari',
      platform: 'macOS 10.13',
      version: '11.0'
    },
    sl_safari_ios: {
      base: 'SauceLabs',
      browserName: 'Safari',
      appiumVersion: '1.7.2',
      deviceName: 'iPhone 8 Simulator',
      deviceOrientation: 'portrait',
      platformVersion: '11.2',
      platformName: 'iOS'
    },
    sl_chrome_android: {
      base: 'SauceLabs',
      appiumVersion: '1.7.2',
      deviceName: 'Android Emulator',
      deviceOrientation: 'portrait',
      browserName: 'Chrome',
      platformVersion: '6.0',
      platformName: 'Android'
    }
  }

  config.set({
    frameworks: ['browserify', 'mocha'],
    files: ['test/*.js'],
    preprocessors: {
      ['test/*.js']: ['browserify']
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
