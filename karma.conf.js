
module.exports = function(config) {
  config.set({
    frameworks: ['browserify', 'mocha', 'karma-typescript'],
    files: ['test/*test*.js', 'test/*test*.ts', { pattern: "frontend/**/*.+(js|ts)" }, { pattern: "src/**/*.+(js|ts)" }, { pattern: "backend/**/*.+(js|ts)" }],
    preprocessors: {
      "src/**/*.+(js|ts)": ["karma-typescript"],
      "frontend/**/*.+(js|ts)": ["karma-typescript"],
      "backend/**/*.+(js|ts)": ["karma-typescript"],
      'test/*.+(ts|js)': ['karma-typescript']
    },
    browserify: {debug: true},
    browsers: ['Chrome', 'Firefox'],
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
