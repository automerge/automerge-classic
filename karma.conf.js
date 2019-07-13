module.exports = function(config) {
  config.set({
    frameworks: ['browserify', 'mocha', 'karma-typescript'],
    files: ['test/*.js', 'test/*.ts'],
    preprocessors: {
      'test/*.js': ['browserify'],
      'test/*.ts': ['karma-typescript']
    },
    browserify: {debug: true},
    browsers: ['Chrome', 'Firefox', 'Safari'],
    singleRun: true,
    karmaTypescriptConfig: {
      tsconfig: './tsconfig.json',
      compilerOptions: {
        allowJs: true,
        sourceMap: true,
      }
    }
  })
}
