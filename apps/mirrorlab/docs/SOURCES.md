# Sources, dependencies, and provenance

Documentation checked while preparing this package on 4–5 October 2026. Equations in the reference kernel are direct analytical implementations, not copied code from an optical package. The items below ground the design choices; they do not imply those packages are already integrated.

| Source | Relevance and boundary |
|---|---|
| [PBRT: Spheres](https://www.pbr-book.org/4ed/Shapes/Spheres) | Analytic ray/sphere intersection and root/intersection conventions. Our sphere is additionally clipped to a finite, front-facing near cap. |
| [PBRT: Specular Reflection and Transmission](https://www.pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission) | Vector reflection, refractive-index context, Snell's law. v0.1 implements specular reflection only. Direction-sign conventions are stated in PHYSICS.md. |
| [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls.html) and [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) | The local viewport and orbit/pan/zoom controls. Pinned modules below, not a moving CDN URL. |
| [Replicad](https://github.com/sgenoud/replicad), [OpenCascade.js](https://github.com/donalffons/opencascade.js), [Open CASCADE](https://github.com/Open-Cascade-SAS/OCCT) | Proposed CAD adapter. No CAD kernel is bundled in Mirrorlab v0.1. Review kernel and wrapper licenses at integration time. |
| [Optiland NSQ limitations](https://optiland.readthedocs.io/en/latest/gallery/nonsequential/limitations_and_roadmap.html) | Potential independent/reference optical engine. The checked page describes prerelease NSQ, no polarization, and missing visibility gradients. Pin and validate a version before using it. |
| [OGC 3D Tiles](https://www.ogc.org/standards/3dtiles/) | Proposed standard for streaming heterogeneous 3D geospatial context. Not a CAD authoring kernel or multiphysics solver. |
| [GitHub custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) | Static app artifact, deployment jobs, and permissions. |
| Splat Tunnel (`apps/splattunnel/`) | Sibling LabStudio module. Its README claims are not repeated as independently validated results. |

## Runtime dependency

Three.js **0.180.0** from the npm `three@0.180.0` package. The viewport bundles only `three.module.min.js`, `three.core.min.js`, `OrbitControls.js`, and the original MIT license. The physics kernel has no dependency on Three.js.

SHA-256 of vendored files:

```text
b97879c748170baadeb3fb84cea1ffdf4674e283dc06042f34e2acb95a76042c  OrbitControls.js
e2b5ee6bccd38fd6d8a2428546b83c5f2426d84b152ef82be8055556e3b40eb6  three.module.min.js
61ba0df005b05991361d040d8ff670e1aadfd0ce7aeebd1fdb0725957a8957de  three.core.min.js
bfe119ea4fd413f5f7ca3fcd63adb0c4a073ed39daa2fe7d3e6b769e21272601  LICENSE
```

No other browser library, font CDN, analytics script, or image service is loaded. The screenshots were rendered from this app, not generated images.

## Updating Three.js

Fetch an explicitly chosen version from its official package, replace the compatible module/core/control files together, retain the upstream license, update these checksums and the package version in this document, and rerun the browser smoke test. Do not update the renderer and controls independently.

## Test tooling

The optional browser workflow pins Playwright 1.51.1. It is not shipped into the browser app. Upgrade it deliberately with browser-test verification; a newer installed runner can also be selected locally. The normal numerical tests use Node's built-in test runner.
