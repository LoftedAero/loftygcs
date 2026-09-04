# Third-party 3D models

Both models come from [betaflight-configurator](https://github.com/betaflight/betaflight-configurator)
(`resources/models/`). The files are byte-identical to upstream; the biplane's colors are
overridden at load time (see `REPAINT` in `src/ui/components/VehicleView.tsx`), which CC-BY
counts as a change and so is stated below.

## airplane.gltf — CC-BY-4.0, credit required

This work is based on ["Low-Poly Biplane"](https://sketchfab.com/3d-models/low-poly-biplane-755175daea384176813e7dc90b2245a5)
by [lord_syrup](https://sketchfab.com/lord_syrup) licensed under
[CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/), and is used here with its colors
changed: the stock red livery is repainted to the neutral grey of the Lofted Aero mark, with
the struts, undercarriage and propeller re-toned so they stay legible against it.

The license requires that credit travels with the model, so the app shows it wherever the
model is drawn — not only here. That is two places now: the Overview tab, and the Logs
tab's 3D replay when the log says a plane flew. Do not remove either line without
replacing the model, and add one anywhere else the biplane appears.

The upstream notice is kept verbatim in `airplane.license.txt`.

## quad_x.gltf — GPL-3.0

Ships in betaflight-configurator with no separate model licence, so it falls under that
project's GPL-3.0. Loft GCS is GPL-3.0 too, which is why this is usable here; a
permissively-licensed fork of this app could not keep it.
