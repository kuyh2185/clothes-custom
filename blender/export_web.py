"""Build one web asset per body: rigged MPFB mannequin + every garment, fitted and skinned, with poses as animations.
blender -b -P blender/export_web.py -- kind=f

Output assets/body_<kind>.glb (Draco-compressed). Extra per-vertex data for the site's shaders:
  body     _m_<garment>  1 where that garment covers the body (MPFB delete groups) → pushed inside so it never pokes through
  garments _h            rest-pose height in metres (cutting the hem, damage, patterns)
           _s            0 on the body panel, 0..1 from shoulder seam to wrist on sleeves (cutting sleeves)
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector, Matrix  # noqa: E402
import common as C  # noqa: E402

HEIGHT = {"f": 1.77, "m": 1.88}
# site garment id → MPFB asset (":lower" keeps the trousers of a combined suit)
GARMENTS = {
    "f": {"tee": "joepal_crude_t-shirt_female", "long": "toigo_fisherman_sweater", "jeans": "female_casualsuit01:lower",
          "skirt": "toigo_long_full_skirt", "shoes": "shoes05"},
    "m": {"tee": "elvs_crude_t-shirt_male", "long": "toigo_fisherman_sweater", "jeans": "male_casualsuit06:lower",
          "skirt": "toigo_long_full_skirt", "shoes": "shoes05"},
}
CLOTHES_DIR = os.path.expanduser("~/tools/blender-4.5.14-windows-x64/portable/extensions/.user/user_default/mpfb/data/clothes")

a = C.args()
kind = a.get("kind", "f")
C.clear_scene()
HS = C.mpfb()["HumanService"]

# ---- body at the model's real height (measure the shaped mesh, not the basis) ----
probe = HS.create_human(mask_helpers=False, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True,
                        scale=0.1, macro_detail_dict=C.BODIES[kind])
bpy.context.view_layer.update()
ev = probe.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
gi0 = probe.vertex_groups["body"].index
h0 = max(ev.vertices[v.index].co.z for v in probe.data.vertices if any(g.group == gi0 and g.weight > .5 for g in v.groups))
bpy.data.objects.remove(probe, do_unlink=True)
body = HS.create_human(mask_helpers=True, detailed_helpers=True, extra_vertex_groups=True, feet_on_ground=True,
                       scale=0.1 * HEIGHT[kind] / h0, macro_detail_dict=C.BODIES[kind])
body.name = "body"
rig = HS.add_builtin_rig(body, "game_engine", import_weights=True)
rig.name = "rig"


def keep_part(ob, which):
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
    bmesh.ops.delete(bm, geom=[v for c in parts if c is not keep for v in c], context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()


garments = {}
for gid, spec in GARMENTS[kind].items():
    name, _, part = spec.partition(":")
    ob = HS.add_mhclo_asset(os.path.join(CLOTHES_DIR, name, name + ".mhclo"), body, asset_type="Clothes",
                            subdiv_levels=1, material_type="MAKESKIN")
    if part:
        keep_part(ob, part)
    ob.name = gid
    garments[gid] = (ob, name)
    print("GARMENT", gid, name, len(ob.data.vertices))

# ---- mannequin body: bake shape keys, drop MPFB helper geometry, egg head ----
bpy.context.view_layer.objects.active = body
for o in bpy.context.selected_objects:
    o.select_set(False)
body.select_set(True)
if body.data.shape_keys:
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
for m in list(body.modifiers):
    if m.type == "MASK":
        if m.name == "Hide helpers":
            m.show_viewport = True
            bpy.ops.object.modifier_apply(modifier=m.name)
        else:
            body.modifiers.remove(m)
me = body.data
top = max(v.co.z for v in me.vertices)
head_h = HEIGHT[kind] / 8.2
chin = top - head_h * 0.98
crown = [v for v in me.vertices if v.co.z > top - head_h * 0.5]
cx = sum(v.co.x for v in crown) / len(crown)
cy = sum(v.co.y for v in crown) / len(crown)
ez = top - head_h * 0.47
rx, ry, rz = head_h * 0.36, head_h * 0.43, head_h * 0.53
for v in me.vertices:
    if v.co.z < chin - head_h * 0.08:
        continue
    d = Vector(((v.co.x - cx) / rx, (v.co.y - cy) / ry, (v.co.z - ez) / rz))
    if d.length < 1e-6:
        continue
    t = Vector((cx, cy, ez)) + Vector((d.x / d.length * rx, d.y / d.length * ry, d.z / d.length * rz))
    v.co = v.co.lerp(t, min(1.0, max(0.0, (v.co.z - (chin - head_h * 0.08)) / (head_h * 0.22))))

# coverage masks per garment, from MPFB's delete groups
for gid, (ob, name) in garments.items():
    vg = body.vertex_groups.get("Delete." + name)
    attr = me.attributes.new("_m_" + gid, "FLOAT", "POINT")
    if vg:
        gi = vg.index
        for v in me.vertices:
            attr.data[v.index].value = max((g.weight for g in v.groups if g.group == gi), default=0.0)
    print("MASK", gid, bool(vg))
for p in me.polygons:
    p.use_smooth = True
sub = body.modifiers.new("smooth", "SUBSURF")
sub.levels = sub.render_levels = 1
body.data.materials.clear()
body.data.materials.append(C.mannequin_material("white"))

# ---- garment attributes: rest height and sleeve parameter ----
bpy.context.view_layer.update()
B = rig.data.bones
def chain(side):
    ua, la, hd = B["upperarm_" + side], B["lowerarm_" + side], B["hand_" + side]
    return [rig.matrix_world @ p for p in (ua.head_local, ua.tail_local, la.tail_local, hd.tail_local)]
ARMS = {s: chain(s) for s in ("l", "r")}
ARM_GROUPS = {f"{b}_{s}" for b in ("upperarm", "lowerarm", "hand") for s in ("l", "r")}


def arm_param(p, side):
    """0 at the shoulder joint … 1 at the wrist, measured along the upper arm + forearm."""
    pts = ARMS[side][:3]
    L = [(pts[i + 1] - pts[i]).length for i in range(2)]
    best = None
    acc = 0
    for i in range(2):
        a_, b_ = pts[i], pts[i + 1]
        ab = b_ - a_
        t = max(0.0, min(1.0, (p - a_).dot(ab) / ab.length_squared))
        d = (a_ + ab * t - p).length
        s = (acc + t * L[i]) / sum(L)
        if best is None or d < best[0]:
            best = (d, s)
        acc += L[i]
    return best[1]


for gid, (ob, name) in garments.items():
    mesh = ob.data
    for m in list(ob.modifiers):
        if m.type == "SUBSURF":   # MPFB leaves the viewport level at 0: subdivide for real (cloth bakes need the final mesh)
            m.show_viewport = True
            m.levels = max(1, m.render_levels)
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier=m.name)
    ah = mesh.attributes.new("_h", "FLOAT", "POINT")
    asl = mesh.attributes.new("_s", "FLOAT", "POINT")
    gidx = {vg.index: vg.name for vg in ob.vertex_groups}
    for v in mesh.vertices:
        w = sum(g.weight for g in v.groups if gidx.get(g.group) in ARM_GROUPS)
        co = ob.matrix_world @ v.co
        ah.data[v.index].value = co.z
        side = "l" if co.x > 0 else "r"
        asl.data[v.index].value = arm_param(co, side) if w > 0.5 and gid in ("tee", "long") else 0.0
    for p in mesh.polygons:
        p.use_smooth = True

# ---- fit variants as shape keys (morph targets), baked with Blender's cloth simulation ----
# "slim" hugs the body (shrinkwrap), "loose"/"wide"/"flare" start from an inflated copy and let gravity drape it over the
# body, pinned where the garment hangs from (shoulders, waistband) — so changing the fit changes the folds, not just the size.
def lerp(a, b, t):
    return a + (b - a) * t


def sstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


Hh = HEIGHT[kind]
L_CROTCH, L_KNEE, L_ANKLE = Hh * 0.47, Hh * 0.28, Hh * 0.055
body_sub = body.modifiers.get("smooth")
coll = body.modifiers.new("collide", "COLLISION")
body.collision.thickness_outer = 0.004
body.collision.thickness_inner = 0.01
body.collision.cloth_friction = 6
if body_sub:
    body_sub.show_viewport = False


def evaluated_coords(ob):
    bpy.context.view_layer.update()
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return [v.co.copy() for v in ev.data.vertices]


def bake_shrink(ob, blend=0.8, where=lambda z: 1.0):
    base = [v.co.copy() for v in ob.data.vertices]
    m = ob.modifiers.new("shrink", "SHRINKWRAP")
    m.target = body
    m.wrap_method = "NEAREST_SURFACEPOINT"
    m.wrap_mode = "OUTSIDE_SURFACE"
    m.offset = 0.0035
    out = [b.lerp(c, blend * where(b.z)) for b, c in zip(base, evaluated_coords(ob))]
    ob.modifiers.remove(m)
    return out


def bake_cloth(ob, offset, pin, frames=40, bend=0.5, mass=0.22):
    me = ob.data
    base = [v.co.copy() for v in me.vertices]
    nrm = [v.normal.copy() for v in me.vertices]
    for v, b, n in zip(me.vertices, base, nrm):
        v.co = b + n * offset(b)
    vg = ob.vertex_groups.get("pin") or ob.vertex_groups.new(name="pin")
    for v, b in zip(me.vertices, base):
        vg.add([v.index], pin(b), "REPLACE")
    m = ob.modifiers.new("cloth", "CLOTH")
    cs = m.settings
    cs.quality = 6
    cs.mass = mass
    cs.tension_stiffness = cs.compression_stiffness = 14
    cs.shear_stiffness = 6
    cs.bending_stiffness = bend
    cs.air_damping = 1.5
    cs.vertex_group_mass = "pin"
    cs.pin_stiffness = 1
    m.collision_settings.collision_quality = 3
    m.collision_settings.distance_min = 0.004
    m.collision_settings.use_self_collision = False
    m.point_cache.frame_start, m.point_cache.frame_end = 1, frames
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, frames
    for f in range(1, frames + 1):
        sc.frame_set(f)
    out = evaluated_coords(ob)
    sc.frame_set(1)
    ob.modifiers.remove(m)
    ob.vertex_groups.remove(vg)
    for v, b in zip(me.vertices, base):
        v.co = b
    return out


def add_keys(ob, keys):
    ob.shape_key_add(name="Basis", from_mix=False)
    for name, coords in keys.items():
        k = ob.shape_key_add(name=name, from_mix=False)
        for i, c in enumerate(coords):
            k.data[i].co = c
        print("KEY", ob.name, name)


for gid, (ob, name) in garments.items():
    if gid == "shoes":
        continue
    zs = [v.co.z for v in ob.data.vertices]
    top, bot = max(zs), min(zs)
    keys = {}
    if gid in ("tee", "long"):
        # the bake happens in the A-pose: sleeves are held almost in shape (pinned) so they don't sag sideways,
        # which would point upward once the arms come down; the body panel drapes freely from the shoulders
        gidx = {vg.index: vg.name for vg in ob.vertex_groups}
        armw = {v.co.freeze() if False else v.index: min(1.0, sum(g.weight for g in v.groups if gidx.get(g.group) in ARM_GROUPS)) for v in ob.data.vertices}
        co_idx = {tuple(round(c, 6) for c in v.co): v.index for v in ob.data.vertices}
        aw = lambda b: armw.get(co_idx.get(tuple(round(c, 6) for c in b), -1), 0.0)
        keys["slim"] = bake_shrink(ob, 0.8)
        keys["loose"] = bake_cloth(ob, lambda b: lerp(0.022 + 0.014 * sstep(top - 0.25, bot, b.z), 0.009, aw(b)),
                                   lambda b: max(sstep(top - 0.10, top - 0.03, b.z), 0.92 * aw(b)), bend=0.4)
    elif gid == "jeans":
        keys["slim"] = bake_shrink(ob, 0.85, lambda z: sstep(L_CROTCH, L_CROTCH - 0.12, z))
        keys["wide"] = bake_cloth(ob, lambda b: 0.004 + 0.034 * sstep(L_CROTCH - 0.05, L_ANKLE, b.z),
                                  lambda b: sstep(top - 0.16, top - 0.05, b.z), bend=1.2, mass=0.3)
    elif gid == "skirt":
        keys["slim"] = bake_shrink(ob, 0.7, lambda z: sstep(top - 0.12, top - 0.3, z))
        keys["flare"] = bake_cloth(ob, lambda b: 0.07 * sstep(top - 0.12, bot, b.z),
                                   lambda b: sstep(top - 0.07, top - 0.02, b.z), bend=0.3)
    add_keys(ob, keys)

# the body panel of a top should follow the torso, not the arms: MPFB's interpolated weights let the hem near the
# hands ride along with the arm (it crumples in the hand-on-hip pose)
shoulder_z = max((rig.matrix_world @ rig.data.bones["upperarm_l"].head_local).z, 0)
for gid in ("tee", "long"):
    ob = garments[gid][0]
    arm_ids = {vg.index for vg in ob.vertex_groups if vg.name in ARM_GROUPS}
    spine = ob.vertex_groups.get("spine_01") or ob.vertex_groups.new(name="spine_01")
    fixed = 0
    for v in ob.data.vertices:
        aw = sum(g.weight for g in v.groups if g.group in arm_ids)
        if aw < 0.5 and v.co.z < shoulder_z - 0.07 and aw > 0:
            for gi in list(arm_ids):
                ob.vertex_groups[gi].remove([v.index])
            if not any(g.weight > 0 for g in v.groups):
                spine.add([v.index], 1.0, "REPLACE")
            fixed += 1
    print("WEIGHTS", gid, fixed)

body.modifiers.remove(coll)
if body_sub:
    body_sub.show_viewport = True

# ---- poses as one-frame actions (rest stays the MPFB A-pose bind pose) ----
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="POSE")
P = rig.pose.bones


def aim(pb, direction):
    bpy.context.view_layer.update()
    head = pb.head.copy()
    q = (pb.tail - pb.head).normalized().rotation_difference(Vector(direction).normalized())
    pb.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


def rot(pb, axis, deg):
    """Rotate a pose bone about an armature-space axis through its head."""
    bpy.context.view_layer.update()
    head = pb.head.copy()
    q = Matrix.Rotation(math.radians(deg), 4, axis)
    pb.matrix = Matrix.Translation(head) @ q @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


def reset():
    for pb in P:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.rotation_mode = "QUATERNION"
    bpy.context.view_layer.update()


def arms_down(lean=(0.15, 0.04)):
    for side, sx in (("l", 1), ("r", -1)):
        aim(P["upperarm_" + side], (sx * lean[0], lean[1], -1))
        aim(P["lowerarm_" + side], (sx * 0.05, -0.17, -1))
        aim(P["hand_" + side], (sx * 0.02, -0.12, -1))


def key(name):
    act = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = act
    for pb in P:
        pb.keyframe_insert("rotation_quaternion", frame=1)
        pb.keyframe_insert("location", frame=1)
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 1, act)
    rig.animation_data.action = None


# MakeHuman stands with the feet apart: bring the legs in under the hips
def legs_in(deg=2.6):
    rot(P["thigh_l"], Vector((0, 1, 0)), deg)
    rot(P["thigh_r"], Vector((0, 1, 0)), -deg)


# stand: straight, arms relaxed at the sides
reset(); legs_in(); arms_down(); key("stand")
# relaxed: weight on the right leg (viewer's left), hip pushed out, shoulders countering, free knee bent
reset()
legs_in()
Y = Vector((0, 1, 0))   # axis pointing back→front (MakeHuman faces -Y)
rot(P["pelvis"], Y, 4.5)
rot(P["spine_02"], Y, -3.5)
rot(P["spine_03"], Y, -2)
rot(P["neck_01"], Y, 2)
rot(P["thigh_r"], Y, -3)
rot(P["thigh_l"], Y, -5)
rot(P["thigh_l"], Vector((1, 0, 0)), -7)
rot(P["calf_l"], Vector((1, 0, 0)), 13)
rot(P["foot_l"], Vector((0, 0, 1)), 14)
arms_down((0.17, 0.05))
key("relaxed")
# hand on hip: right hand on the hip, elbow out
reset()
legs_in()
rot(P["pelvis"], Y, 4.5)
rot(P["spine_02"], Y, -3.5)
rot(P["thigh_r"], Y, -3)
rot(P["thigh_l"], Y, -5)
rot(P["thigh_l"], Vector((1, 0, 0)), -7)
rot(P["calf_l"], Vector((1, 0, 0)), 13)
arms_down((0.17, 0.05))
aim(P["upperarm_l"], (0.75, 0.05, -0.75))
aim(P["lowerarm_l"], (-0.85, -0.25, -0.45))
aim(P["hand_l"], (-0.35, -0.2, -0.9))
key("hip")
reset()
bpy.ops.object.mode_set(mode="OBJECT")

# ---- export ----
for o in bpy.context.selected_objects:
    o.select_set(False)
for o in [rig, body] + [g for g, _ in garments.values()]:
    o.select_set(True)
out = os.path.join(C.OUT, f"body_{kind}.glb")
bpy.ops.export_scene.gltf(
    filepath=out, export_format="GLB", use_selection=True, export_apply=True,
    export_skins=True, export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
    export_attributes=True, export_yup=True, export_image_format="WEBP", export_jpeg_quality=82,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
print("EXPORTED", out, os.path.getsize(out))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(C.PREVIEW, f"web_{kind}.blend"))
