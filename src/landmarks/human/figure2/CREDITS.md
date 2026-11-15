# Figure2 sources and licence

The person is the **Microsoft Rocketbox** avatar `Male_Adult_01`: a rigged mesh (FBX, "Bip01"
skeleton) with photographic colour, normal, specular and opacity (hair card) textures.

- Repository: https://github.com/microsoft/Microsoft-Rocketbox
- Folder: `Assets/Avatars/Adults/Male_Adult_01/` (`Export/Male_Adult_01.fbx`, `Textures/m002_*.tga`)
- Downloaded: 15 November 2026
- Licence: MIT (below)

## How it was made

1. `tools/build-figure.py` (Blender 5.1, run headless) poses the skeleton — weight on the left leg,
   right forearm held level in front with the palm down, fingers relaxed, head bowed looking at the
   back of the right hand, left arm relaxed — evaluates the skinning (dual quaternion, corrective
   smooth on the joints), bakes the pose into static geometry (subdivided once for the high tier),
   bakes ambient occlusion with a ground plane (Cycles), scales him to 1.70 m standing height, levels
   the back of the right hand so its surface normal at the anchor is exactly up, moves the anchor to
   the origin, and writes `figure_high.bin`, `figure_low.bin`, `figure.json` and
   `src/landmarks/human/figureData.ts`.
2. `tools/build-figure-tex.py` (Python + Pillow + numpy) pads the UV gutters, resizes the textures to
   2048² and 1024², packs normal XY + specular, derives a skin/cloth mask and a mask of the hair painted
   on the scalp, feathers the hair cards' straight cut edges in their alpha, and writes JPG/WebP/PNG.

Rebuild (from the repo root; `<rb>` holds the FBX and the `m002_*.tga` textures):

```
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build-figure.py -- <rb> public/assets/human/figure
python3 -I tools/build-figure-tex.py <rb> public/assets/human/figure
```

The shading (`shaders.ts`) is original work.

## Licence (MIT, from the repository's LICENSE.md)

MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
