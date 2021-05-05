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
  },
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: 'defaults' }],
            ]
          }
        }
      }
    ]
  }
}
