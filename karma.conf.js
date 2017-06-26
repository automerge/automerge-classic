module.exports = function(config) {
  config.set({
    frameworks: ['browserify', 'mocha'],
    files: ['test/*.js'],
    preprocessors: {
      ['test/*.js']: ['browserify']
    },
    browserify: {debug: true},
    browsers: ['Chrome', 'Firefox'],
    singleRun: true
  })
}
