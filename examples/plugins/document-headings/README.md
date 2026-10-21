# Document headings example

The host-rendered heading list follows Specular's dark/light mode automatically. Verify initial appearance, live switching, and heading source navigation in both modes using the independently built package; no theme-specific rendering or core imports are needed.

This is a second independently buildable, data-driven plugin. It uses only `@specular/plugin-api`: no Specular source imports are needed at build time or runtime.

It lists Markdown headings from the currently selected document. Each heading has source evidence, so selecting its evidence opens the matching text in Specular. The view deliberately reports an empty list if no Markdown document is selected or while the shared index is not ready.

## Build and install

From the Specular repository, package the local SDK first:

```sh
npm run sdk:pack
```

Copy this directory to an author workspace, then install the generated `specular-plugin-api-0.2.0.tgz`, build, and validate:

```sh
npm install --save-dev /absolute/path/specular-plugin-api-0.2.0.tgz
npm run build
npm run validate
```

In Specular, choose **Project Lens > Install plugin folder...** and select the built directory. The installed package needs only `package.json`, `specular-plugin.json`, and `dist/index.js`.
