# Third-party 3D models

Both models come from [betaflight-configurator](https://github.com/betaflight/betaflight-configurator)
(`resources/models/`). The files are byte-identical to upstream; the biplane's colors are
overridden at load time (see `REPAINT` in `src/ui/components/VehicleView.tsx`) and again in
the pre-rendered calibration art, which CC-BY counts as a change and so is stated below.

## airplane.gltf — CC-BY-4.0, credit required

This work is based on ["Low-Poly Biplane"](https://sketchfab.com/3d-models/low-poly-biplane-755175daea384176813e7dc90b2245a5)
by [lord_syrup](https://sketchfab.com/lord_syrup) licensed under
[CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/), and is used here with its colors
changed: the stock red livery is repainted to the neutral grey of the Lofted Aero mark, with
the struts, undercarriage and propeller re-toned so they stay legible against it.

The license requires that credit travels with the model, so the app shows it wherever the
model is drawn — not only here. That is three places now: the Overview tab, the Logs
tab's 3D replay when the log says a plane flew, and the calibration attitude tiles on
Sensors. Do not remove any of those lines without replacing the model, and add one
anywhere else the biplane appears — **including a picture of it**. The calibration tiles
draw no model at runtime at all: they are `cal-attitudes-plane.png`, rendered from this
file by `npm run cal-art` (scripts/make-cal-art.mjs). A rendering is still the work, so it
carries the same credit, and the credit is dropped there for the same reason it is on
Overview — when the vehicle is an F-35B, the biplane is not on screen.

The upstream notice is kept verbatim in `airplane.license.txt`.

## f35b.glb — Lofted Aero, own work

Generated from `F-35B Solid Model.STEP`, the SolidWorks assembly for Lofted Aero's own
3D-printed F-35B: tessellated in FreeCAD at 0.6 mm (73k triangles), welded and decimated to
30k in Blender, auto-smoothed at 30 degrees, and re-oriented to the convention the biplane
already uses (span on X, nose toward +Y, up on Z) so the two are interchangeable to the
renderers. No third-party geometry, so nothing here needs a credit line in the app — unlike
the biplane below.

The numbers are load-bearing, and two rounds of getting them wrong are worth recording.

A first pass tessellated at 1.5 mm and decimated to 5k melted the nose and left the wing edges
ragged: collapse decimation moves vertices off the real surface, and it has nowhere good to
move them when the triangles are already coarser than the curvature. Tessellate finely and
decimate gently, not the other way round.

The patchy shading that survived that was **not** a polygon-count problem, and it is worth
saying so because lowering the count is the obvious wrong move. Measured, in order: 68k and
30k triangles render identically; there are only ~100 interior faces from the interpenetrating
solids; weighted normals change nothing. What was left was 311 sliver triangles (longest edge
more than 20x the shortest) out of 30k. The tessellator triangulates each CAD patch on its
own, so patch boundaries collect slivers, and a vertex normal averaged over a sliver points
somewhere arbitrary — which is exactly a sharply bounded bright facet on a smooth surface.
Welding at 0.006 model units (about 5 mm on the real 1.7 m aircraft: smaller than any panel
line, larger than every sliver) takes that from 311 to 48 without changing the shape, and the
length is checked afterwards because a careless weld eats the nose tip.

Do not delete "interior" faces after that weld. Before welding the detector finds ~100 and
removing them changes nothing; afterwards it claims 4,000, takes real surface with it, and
leaves a notch by the canopy.

The material is matte and non-metallic. Neither renderer has an environment map, and a
metallic surface with nothing to reflect shades dark and blotchy — and a painted aircraft
should not be shiny anyway.

The pipeline is in the commit that added it; the source CAD is not in this repo.

## quad_x.gltf — GPL-3.0

Ships in betaflight-configurator with no separate model license, so it falls under that
project's GPL-3.0. Loft GCS is GPL-3.0 too, which is why this is usable here; a
permissively-licensed fork of this app could not keep it.
