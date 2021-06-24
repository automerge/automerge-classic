const path = require('path')
const webpack = require('webpack')
const webpackConfig = require('./webpack.config.js')

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
    browsers: ['Chrome', 'Firefox', 'Safari'],
    singleRun: true,
    // Webpack can handle Typescript via ts-loader
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
    }
  })
}
