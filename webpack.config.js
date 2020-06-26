const path = require('path')

const typescriptConfig = {
  resolve: {
    extensions: [ '.ts', '.js' ],
  },
  module: {
    rules: [
      // all files with a `.ts` extension will be handled by `ts-loader`
      { test: /\.ts$/, exclude: /node_modules/, loaders: ['babel-loader','ts-loader'], }
    ]
  }
}

const commonConfig = {
  entry: './src/automerge.ts',
  mode: 'development',
  output: {
    filename: 'automerge.js',
    library: 'Automerge',
    libraryTarget: 'umd',
    path: path.resolve(__dirname, 'dist'),
    // https://github.com/webpack/webpack/issues/6525
    globalObject: 'this'
  },
  devtool: 'source-map',
  module: {
    rules: [
      // Order important
      ...typescriptConfig.module.rules,
      { test: /\.js$/, exclude: /node_modules/, loader: "babel-loader" }
    ]
  },
  resolve: typescriptConfig.resolve
}

module.exports = commonConfig
