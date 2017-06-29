var path = require('path');

module.exports = {
  entry: './src/automerge.js',
  output: {
    filename: 'automerge.js',
    library: 'Automerge',
    path: path.resolve(__dirname, 'dist')
  }
}
