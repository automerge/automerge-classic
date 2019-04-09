module.exports = function(config) {
  config.set({
    frameworks: ['mocha', 'karma-typescript'],
    files: ['test/*.ts'],
    preprocessors: {
      'test/*.ts': ['karma-typescript'],
    },
    browsers: ['Chrome', 'Firefox'],
    singleRun: true,
    karmaTypescriptConfig: {
      tsconfig: './tsconfig.json',
      compilerOptions: {
        allowJs: true,
        sourceMap: true,
      },
    },
  })
}
