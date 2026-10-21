# Specular plugin template

The generated list view automatically follows Specular's upper-right light/dark switch through host rendering. Test initial activation and live switching in both modes. If you replace it with a custom interface, use the public SDK's optional `request.appearance` and `--specular-*` CSS variables, retain dark fallbacks for older hosts, and preserve filter/selection/scroll state on theme-only updates. See the custom-definition-browser example and the SDK Appearance documentation; do not import core theme code.

Copy this directory before editing it. Rename the package, plugin ID, view ID, and title in `package.json` and `specular-plugin.json`. The starter uses the public SDK only and returns one source-backed item for each ID definition in the current project model.

Build against the packaged SDK, not the Specular repository source:

```sh
npm install --save-dev /absolute/path/specular-plugin-api-0.2.0.tgz
npm run build
npm run validate
```

The compiled entry must be self-contained ESM. Declare only the models the plugin reads in `"models"` (this template reads `project@1`). Keep source references from the model unchanged except for adding the request context's `projectId` and `revision`; this lets Specular reject stale or foreign evidence safely. Return the request's API version, request ID, view ID, project ID, and revision unchanged. Recompute from every request because activation, document selection, edits, and project changes can provide new models.

Do not import Specular internals, Node modules, network modules, or application DOM APIs. The runtime provides only the serializable request and result contract.
