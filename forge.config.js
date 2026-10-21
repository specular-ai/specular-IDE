module.exports = {
  packagerConfig: {
    asar: { unpack: '**/node-pty/**' },
    executableName: 'Specular',
    extraResource: ['examples/first-project'],
    ignore: [/^\/(?:src|tests|scripts|bundled-plugins|\.cache|\.git|test-results|playwright-report)(?:\/|$)/],
  },
  hooks: {
    generateAssets: async () => { await import('./scripts/build.mjs'); },
  },
  // node-pty 1.1.0 ships Node-API Windows binaries, verified in the packaged app.
  rebuildConfig: { ignoreModules: ['node-pty'] },
};
