# Figure2 sources and licence

The person's body is derived from the MakeHuman base mesh, skeleton, skinning weights and macro
targets, released under **CC0 1.0 Universal** (public domain dedication) by the MakeHuman project.

- Repository: https://github.com/makehumancommunity/makehuman
- Commit: `a8bc2d54ff0ac92e78ff71431b1023eda42bf482` (branch `master`, fetched 2026-11-13)
- Licence: `LICENSE.md` section C ("The license for the bundled assets": base mesh, proxies, targets,
  skeletons … "released under CC0 1.0 Universal") and the full CC0 text in `LICENSE.ASSETS.md`.
  Each file also carries its own header ("This asset was explicitly released as CC0 in september 2020";
  `default.mhskel` and `default_weights.mhw` have `"license": "CC0"`).

Files used (raw URLs at that commit, `https://raw.githubusercontent.com/makehumancommunity/makehuman/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/…`):

| File | Use |
| --- | --- |
| `makehuman/data/3dobjs/base.obj` (hm08 base mesh) | body surface (group `body`), eyeballs (`helper-r-eye`, `helper-l-eye`); all other helper and joint groups dropped |
| `makehuman/data/rigs/default.mhskel` | default skeleton (163 bones; joint positions from vertex groups) |
| `makehuman/data/rigs/default_weights.mhw` | skinning weights (dual-quaternion skinning, 4 influences) |
| `makehuman/data/targets/macrodetails/{caucasian,african,asian}-{male,female}-young.target` | macro shape: gender 0.85, age 25, mixed ancestry |
| `makehuman/data/targets/macrodetails/universal-{male,female}-young-averagemuscle-maxweight.target` | weight 0.66 (slightly above MakeHuman's average) |

Everything else (pose, clothing, straw hat, sunglasses, hair shell, AO/thickness bake, shaders) is
original work in `tools/build-figure.mjs` and this folder. No textures or images are used.

Rebuild: download the files above into a folder `<dir>` (targets into `<dir>/targets/`) and run
`node tools/build-figure.mjs <dir>` → `public/assets/human/figure/`.
