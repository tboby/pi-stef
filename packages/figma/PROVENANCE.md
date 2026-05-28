# Figma Package Provenance

This package is extracted from fh-agent.

## Internal Migration

- `packages/figma/src/context/FigmaApi.ts` derives from `packages/figma-context/src/modules/figma/FigmaApi.ts`.
- `packages/figma/src/auth/FigmaAuthorization.ts` derives from `packages/figma-context/src/modules/figma/FigmaAuthorization.ts` and changes the canonical credential location to `~/.pi/figma/config.json`.
- `packages/figma/src/context/FigmaContext.ts` derives from `packages/figma-context/src/modules/figma/FigmaContext.ts`.
- `packages/figma/src/context/FigmaNodeParser.ts` derives from `packages/figma-context/src/modules/figma/FigmaNodeParser.ts`.
- `packages/figma/src/schemas.ts` derives from `packages/figma-context/src/modules/figma/schemas.ts`.
- `packages/figma/extensions/figma.ts` derives from `packages/figma-context/extensions/figma-context.ts`.

## External Research Inputs

The planning phase reviewed these REST-oriented Pi Figma packages for tool-surface and output-shaping ideas. No external source file has been copied into M1.

- `pi-mono-figma@0.2.2`, npm tarball `https://registry.npmjs.org/pi-mono-figma/-/pi-mono-figma-0.2.2.tgz`, MIT license in tarball.
- `@originintelligence/pi-figma@0.1.0`, npm tarball `https://registry.npmjs.org/@originintelligence/pi-figma/-/pi-figma-0.1.0.tgz`, repository `https://github.com/sanchezcodes/pi-figma`, MIT license.
- `pi-figma@1.0.1`, npm tarball `https://registry.npmjs.org/pi-figma/-/pi-figma-1.0.1.tgz`, MIT license in tarball.

MIT license text for researched packages:

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

If later milestones copy or substantially adapt external code, add the source file, package version, URL, license, and derivation note here before committing that milestone.
