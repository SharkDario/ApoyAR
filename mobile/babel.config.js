// babel.config.js
// Configura Babel para Expo con soporte de path aliases (@theme, @screens, etc.)
// Requiere: babel-plugin-module-resolver (instalado como devDependency de Expo).

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['.'],
          alias: {
            '@theme':      './src/theme',
            '@components': './src/components',
            '@screens':    './src/screens',
            '@navigation': './src/navigation',
            '@hooks':      './src/hooks',
          },
          extensions: ['.ts', '.tsx', '.js', '.jsx'],
        },
      ],
    ],
  };
};
