var path = require('path');

module.exports = {
  entry: './src/tesseract.js',
  output: {
    filename: 'tesseract.js',
    library: 'tesseract',
    path: path.resolve(__dirname, 'dist')
  }
}
