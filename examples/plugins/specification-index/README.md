# Standalone specification-index plugin

This host-rendered list inherits Specular's dark/light mode automatically, including live switching. No palette code or core imports are needed. Validate readable entries and source links in both modes after building independently against the public SDK.

This increment 30 authoring example turns indexed definitions into a list with current source evidence. Duplicate authored IDs remain separate rows by file and offset. It emits an empty list while the index is pending. Increment 31 can run it inside Specular: open a Markdown project, choose Project Lens > Open plugin view..., and select this directory after building it. The list opens in a workspace tab with source-navigation buttons. Loaded-plugin buttons reopen it after tab closure or project changes. Loading is session-only; restart to load a replacement. Persistent installation remains increment 33.

Copy this entire folder outside the Specular repository. Obtain the local SDK tarball and follow the [SDK authoring instructions](../../../packages/plugin-api/README.md), which are also included inside the installed SDK package at `node_modules/@specular/plugin-api/README.md`:

```sh
npm install --save-dev /absolute/path/specular-plugin-api-0.2.0.tgz
npm run build
npm run validate
```

The generated `dist/index.js`, `specular-plugin.json`, and `package.json` form the minimal local plugin package. It imports only public SDK types at build time and has no runtime dependencies. A compiler/Node installation is required; Specular source and an application rebuild are not.

Repository maintainers can run `npm.cmd run test:sdk` from the Specular root. This packs the SDK, copies this example to an OS temporary directory, installs only the SDK artifact offline, compiles using the existing TypeScript toolchain, validates the package, and tests the trusted example's output and rejection cases. The proof temporarily removes the compiler dependency from the copied package because it reuses the already installed compiler executable; no Specular source is copied or imported. It leaves the temporary directory available for inspection. This is an authoring/contract proof. After it succeeds, `npx.cmd playwright test tests/ui/plugins.spec.ts` verifies the runtime in Electron; set `SPECULAR_TEST_PACKAGED=1` after packaging to test the Windows artifact. The temporary directory is also recorded in `.cache/plugin-sdk/example-path.txt`.
