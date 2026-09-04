const webpack = require('webpack');

/**
 * Custom webpack config to handle Node.js built-in modules with the "node:" URI scheme
 * which Angular's default webpack 5 setup doesn't resolve.
 */
module.exports = {
  resolve: {
    fallback: {
      fs: false,
      path: false,
      https: false,
      http: false,
      crypto: false,
      stream: false,
      zlib: false,
      url: false,
    },
  },
  plugins: [
    // Strip the "node:" prefix so webpack can resolve built-ins using the fallbacks above
    new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, '');
    }),
  ],
};
