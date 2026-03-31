const path = require('path');
const { ModuleFederationPlugin } = require('webpack').container;
const { WatchIgnorePlugin } = require('webpack');
const packageJson = require('./package.json');

module.exports = {
  entry: './src/index',
  mode: 'production',

  output: {
    path: path.resolve(__dirname, 'public'),
    filename: 'bundle.js'
  },

  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              '@babel/preset-env',
              '@babel/preset-react'
            ]
          }
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(png|svg|jpg|gif)$/,
        loader: 'file-loader',
        options: {
          name: '[path][name].[ext]'
        }
      }
    ]
  },

  plugins: [
    new ModuleFederationPlugin({
      name: packageJson.name.replace(/[-@/]/g, '_'),
      filename: 'remoteEntry.js',
      exposes: {
        './PluginConfigurationPanel': './src/components/PluginConfigurationPanel.jsx'
      },
      shared: {
        react: {
          singleton: true,
          requiredVersion: false,
          import: false
        },
        'react-dom': {
          singleton: true,
          requiredVersion: false,
          import: false
        }
      }
    }),

    new WatchIgnorePlugin({
      paths: [path.resolve(__dirname, 'public/')]
    })
  ]
};
