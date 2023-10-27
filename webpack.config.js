const path = require('path')
const webpack = require('webpack')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const dev = process.env.NODE_ENV !== 'production'

baseConfig = {
  mode: dev ? 'development' : 'production',
  module: {
    rules: [
      {
        test: /\.sass$/, use: [
          {
            loader: 'css-loader',
            options: {
              exportType: 'string'
            }
          }, {
            loader: 'sass-loader'
          }
        ]
      },
      {
        test: /\.jsx$/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env'],
              plugins: ['@babel/plugin-transform-react-jsx']
            }
          }
        ]
      },
      {
        test: /\.js$/,
        use: [
          {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env'],
            }
          }
        ]
      },
      {
        test: /\.png$/,
        use: 'file-loader'
      },
      {
        test: /\.pug$/,
        use: [
          {
            loader: 'pug-loader',
            options: {}
          }
        ]
      }
    ]
  },
  devtool: 'source-map'
}

module.exports = [
  Object.assign({}, baseConfig, {
    entry: {
      'clientrender': './view/clientrender.jsx',
    },
    output: {
      path: path.join(__dirname, './dist'),
      publicPath: '/resources/',
      filename: '[hash]-[name].js'
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './view/index.pug',
        minify: dev ? false : {removeComments: true, useShortDoctype: true, sortClassName: true, sortAttributes: true},
        chunks: [ 'clientrender' ],
        inject: false
      }),
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV)
      })
    ]
  })
]
