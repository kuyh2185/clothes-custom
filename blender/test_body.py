"""Quick look at the MPFB model bodies as display mannequins.
blender -b -P blender/test_body.py -- kind=f finish=black
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import common as C  # noqa: E402

a = C.args()
kind, finish = a.get("kind", "f"), a.get("finish", "black")
C.clear_scene()
body = C.make_body(kind)
bpy.context.view_layer.objects.active = body
mod = body.modifiers.new("smooth", "SUBSURF")
mod.levels = mod.render_levels = 1
body.data.materials.clear()
body.data.materials.append(C.mannequin_material(finish))
for p in body.data.polygons:
    p.use_smooth = True
h = max(v.co.z for v in body.data.vertices)
print("BODY HEIGHT", round(h, 3))
C.studio(target_z=h / 2, cam_dist=h * 3.1)
C.render(os.path.join(C.PREVIEW, f"body_{kind}_{finish}.png"))
