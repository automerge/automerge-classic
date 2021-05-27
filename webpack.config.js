const path = require('path')

module.exports = {
  entry: './src/automerge.js',
  mode: 'development',
  output: {
    filename: 'automerge.js',
    library: 'Automerge',
    libraryTarget: 'umd',
    path: path.resolve(__dirname, 'dist'),
    // https://github.com/webpack/webpack/issues/6525
    globalObject: 'this',
    // https://github.com/webpack/webpack/issues/11660
    chunkLoading: false,
  },
  devtool: 'source-map',
  module: {rules: []},
  target: "browserslist:web"
}
