/* eslint-env node */

const path = require('path');

module.exports = {
    entry: {
        ui: './webAIO/ui.js',
        client: './webAIO/client.js',
        master: './webAIO/master.js'
    },
    output: {
        path: path.resolve(__dirname, 'webAIO'),
        filename: '[name].b.js'
    },
    module: {
        rules: [
          {
            test: /\.m?js$/,
            exclude: /(node_modules|bower_components)/,
            use: {
              loader: 'babel-loader',
              options: {
                presets: [
                  [
                    '@babel/preset-env', {
                      useBuiltIns: 'usage',
                      targets: 'defaults',
                      corejs: 3
                    }
                  ]
                ]
              }
            }
          }
        ]
      },

    devtool: 'source-map',
    mode: 'production'
};