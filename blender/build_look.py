"""Dress an MPFB model body as a display mannequin and render a studio preview.
blender -b -P blender/build_look.py -- kind=m clothes=male_casualsuit06,shoes05 finish=black out=look_m
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Vector, Matrix  # noqa: E402
import common as C  # noqa: E402

HEIGHT = {"f": 1.77, "m": 1.88}
a = C.args()
kind = a.get("kind", "m")
finish = a.get("finish", "black")
clothes = [c for c in a.get("clothes", "").split(",") if c]
out = a.get("out", f"look_{kind}")

C.clear_scene()
S = C.mpfb()
HS = S["HumanService"]

# body at the model's height
probe = HS.create_human(mask_helpers=False, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True,
                        scale=0.1, macro_detail_dict=C.BODIES[kind])
bpy.context.view_layer.update()
ev = probe.evaluated_get(bpy.context.evaluated_depsgraph_get()).data   # with the shape keys (the real shape)
gi0 = probe.vertex_groups["body"].index
h0 = max(ev.vertices[v.index].co.z for v in probe.data.vertices if any(g.group == gi0 and g.weight > .5 for g in v.groups))
bpy.data.objects.remove(probe, do_unlink=True)
body = HS.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True,
                       scale=0.1 * HEIGHT[kind] / h0, macro_detail_dict=C.BODIES[kind])
body.name = "body"
rig = HS.add_builtin_rig(body, "game_engine", import_weights=True)
rig.name = "rig"

# clothes, fitted by MPFB's proxy system and skinned to the rig
CLOTHES_DIR = os.path.join(os.environ.get("MPFB_DATA", ""), "clothes")
if not os.path.isdir(CLOTHES_DIR):
    CLOTHES_DIR = os.path.expanduser("~/tools/blender-4.5.14-windows-x64/portable/extensions/.user/user_default/mpfb/data/clothes")
items = []
def keep_part(ob, which):
    """Combined suits are a top and a bottom in one mesh: keep only the upper or lower loose part."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    seen, parts = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, comp = [v], []
        seen.add(v.index)
        while stack:
            x = stack.pop()
            comp.append(x)
            for e in x.link_edges:
                o = e.other_vert(x)
                if o.index not in seen:
                    seen.add(o.index)
                    stack.append(o)
        parts.append(comp)
    parts.sort(key=lambda c: sum(v.co.z for v in c) / len(c))
    keep = parts[-1] if which == "upper" else parts[0]
    kill = [v for c in parts if c is not keep for v in c]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()


for spec in clothes:
    name, _, part = spec.partition(":")
    f = os.path.join(CLOTHES_DIR, name, name + ".mhclo")
    ob = HS.add_mhclo_asset(f, body, asset_type="Clothes", subdiv_levels=1, material_type="MAKESKIN")
    if part:
        keep_part(ob, part)
    items.append(ob)
    print("ADDED", spec, ob.name if ob else None)


def aim(pb, direction, roll_keep=True):
    """Rotate pose bone so its head→tail points along `direction` (armature space)."""
    bpy.context.view_layer.update()
    head, tail = pb.head.copy(), pb.tail.copy()
    cur = (tail - head).normalized()
    q = cur.rotation_difference(Vector(direction).normalized())
    m = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ pb.matrix
    pb.matrix = m
    bpy.context.view_layer.update()


# relaxed standing pose: arms hang close to the body with soft elbows, hands by the thighs
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
P = rig.pose.bones
for side, sx in (("l", 1), ("r", -1)):
    aim(P["upperarm_" + side], (sx * 0.16, 0.04, -1))
    aim(P["lowerarm_" + side], (sx * 0.06, -0.16, -1))
    aim(P["hand_" + side], (sx * 0.02, -0.12, -1))
bpy.ops.object.mode_set(mode="OBJECT")

# display-mannequin head: project the face onto a smooth egg so it has no features
# (MPFB keeps the body shape in shape keys: bake them first so editing the vertices sticks)
bpy.context.view_layer.update()
bpy.context.view_layer.objects.active = body
for o in bpy.context.selected_objects:
    o.select_set(False)
body.select_set(True)
if body.data.shape_keys:
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
me = body.data
# only the visible body (MPFB also carries hidden helper geometry: clothes/hair fitting shells)
gi = body.vertex_groups["body"].index
real = [v for v in me.vertices if any(g.group == gi and g.weight > .5 for g in v.groups)]
top = max(v.co.z for v in real)
head_h = HEIGHT[kind] / 8.2
chin = top - head_h * 0.98
crown = [v for v in real if v.co.z > top - head_h * 0.5]
cx = sum(v.co.x for v in crown) / len(crown)
cy = sum(v.co.y for v in crown) / len(crown)
ez = top - head_h * 0.47
rx, ry, rz = head_h * 0.36, head_h * 0.43, head_h * 0.53
moved = 0
for v in real:
    if v.co.z < chin - head_h * 0.08:
        continue
    d = Vector(((v.co.x - cx) / rx, (v.co.y - cy) / ry, (v.co.z - ez) / rz))
    if d.length < 1e-6:
        continue
    target = Vector((cx, cy, ez)) + Vector((d.x / d.length * rx, d.y / d.length * ry, d.z / d.length * rz))
    w = min(1.0, max(0.0, (v.co.z - (chin - head_h * 0.08)) / (head_h * 0.22)))
    v.co = v.co.lerp(target, w)
    moved += 1
print("HEAD", round(top, 3), moved)

# looks: mannequin finish; garments keep their textures (diffuse + normal + AO) for now
body.data.materials.clear()
body.data.materials.append(C.mannequin_material(finish))
for ob in [body] + items:
    for p in ob.data.polygons:
        p.use_smooth = True
sub = body.modifiers.new("smooth", "SUBSURF")
sub.levels = sub.render_levels = 1

C.studio(target_z=HEIGHT[kind] * 0.5, cam_dist=HEIGHT[kind] * 3.4)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(C.PREVIEW, out + ".blend"))
C.render(os.path.join(C.PREVIEW, out + ".png"))
