"""Build one web asset per body: rigged MPFB mannequin + every garment, fitted and skinned, with poses as animations.
blender -b -P blender/export_web.py -- kind=f

Output assets/body_<kind>.glb (Draco-compressed). Extra per-vertex data for the site's shaders:
  body     _m_<garment>  1 where that garment covers the body (MPFB delete groups) → pushed inside so it never pokes through
  garments _h            rest-pose height in metres (cutting the hem, damage, patterns)
           _s            0 on the body panel, 0..1 from shoulder seam to wrist on sleeves (cutting sleeves)
           _x            tops only: 1 on the fabric added below the asset's own hem (so the top can be made longer)
Shape keys (morph targets): slim / loose / wide / flare (fit), over_jeans / over_skirt (a top worn out over the bottom).
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


def apply_first(ob, m):
    """Apply a modifier as if it were first in the stack (the garment's armature is at rest anyway)."""
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0)
    bpy.ops.object.modifier_apply(modifier=m.name)
    ob.select_set(False)


EXT, RINGS = 0.22, 9   # extra fabric below a top's own hem, so "longer" really gets longer


def torso_hem(bm):
    """Boundary edges of the hem going round the torso (centred on x = 0, lowest; sleeve cuffs are off to the sides)."""
    bound = [e for e in bm.edges if e.is_boundary]
    adj = {}
    for e in bound:
        for v in e.verts:
            adj.setdefault(v, []).append(e)
    seen, loops = set(), []
    for e in bound:
        if e in seen:
            continue
        comp, stack = [], [e]
        seen.add(e)
        while stack:
            x = stack.pop()
            comp.append(x)
            for v in x.verts:
                for y in adj[v]:
                    if y not in seen:
                        seen.add(y)
                        stack.append(y)
        loops.append(comp)
    def centre(c):
        vs = {v for e in c for v in e.verts}
        return sum(v.co.x for v in vs) / len(vs), sum(v.co.z for v in vs) / len(vs), max(v.co.x for v in vs) - min(v.co.x for v in vs)
    torso = [c for c in loops if abs(centre(c)[0]) < 0.04 and centre(c)[2] > 0.2]
    return min(torso, key=lambda c: centre(c)[1])


def trim_rib(ob, dense=0.012):
    """A knitted rib hem is many rows packed into ~1 cm; the cloth sim and the stripes stretch it into a band.
    Drop those packed rows (only when there are several), so the hem is ordinary fabric that the added length continues."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    hem = torso_hem(bm)
    ring = {v: 0 for e in hem for v in e.verts}
    cur, rings = list(ring), [list(ring)]
    for k in range(1, 30):
        nxt = {o for v in cur for e in v.link_edges for o in [e.other_vert(v)] if o not in ring}
        if not nxt:
            break
        for v in nxt:
            ring[v] = k
        cur = list(nxt)
        rings.append(cur)
    z0 = sum(v.co.z for v in rings[0]) / len(rings[0])
    R = next((k for k, r in enumerate(rings) if sum(v.co.z for v in r) / len(r) > z0 + dense), 0)
    if R >= 3:
        bmesh.ops.delete(bm, geom=[v for r in rings[:R] for v in r], context="VERTS")
        bm.to_mesh(ob.data)
        print("TRIM", ob.name, R, "rows")
    bm.free()


def extend_hem(ob):
    """Continue the body panel's hem straight down (rings of quads), texture continuing, weights copied from the hem,
    then pushed just outside the body where the hips/thighs are in the way. Returns the new vertex indices."""
    trim_rib(ob)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    hem = torso_hem(bm)
    ring0 = list({v for e in hem for v in e.verts})
    hem_faces = list({f for e in hem for f in e.link_faces})
    cx = sum(v.co.x for v in ring0) / len(ring0)
    cy = sum(v.co.y for v in ring0) / len(ring0)
    face_ids = lambda v: {l.face.index for l in v.link_loops}
    uvinfo = {}
    for v in ring0:
        l0 = v.link_loops[0]
        uv0 = l0[uvl].uv.copy()
        ups = [e.other_vert(v) for e in v.link_edges if not e.is_boundary]
        p = max(ups, key=lambda u: u.co.z) if ups else None
        duv = uv0 * 0
        if p is not None:
            lp = next((l for l in p.link_loops if l.face.index == l0.face.index), p.link_loops[0])
            d = max((v.co - p.co).length, 1e-4)
            duv = (uv0 - lp[uvl].uv) / d
        uvinfo[v] = (uv0, duv)
    step = EXT / RINGS
    origin, ring = {v: v for v in ring0}, {v: 0 for v in ring0}
    base = {v: v.co.copy() for v in ring0}
    cur = set(ring0)
    cur_edges = hem
    new_faces, new_verts = [], []
    for k in range(1, RINGS + 1):
        res = bmesh.ops.extrude_edge_only(bm, edges=cur_edges)
        nv = [g for g in res["geom"] if isinstance(g, bmesh.types.BMVert)]
        nset = set(nv)
        for v in nv:
            src = next(e.other_vert(v) for e in v.link_edges if e.other_vert(v) in cur)
            o = origin[src]
            origin[v], ring[v] = o, k
            r = Vector((base[o].x - cx, base[o].y - cy, 0))
            r = r.normalized() if r.length > 1e-6 else r
            v.co = base[o] + Vector((0, 0, -k * step)) + r * (k * step * 0.06)
        new_verts += nv
        new_faces += [g for g in res["geom"] if isinstance(g, bmesh.types.BMFace)]
        cur_edges = [g for g in res["geom"] if isinstance(g, bmesh.types.BMEdge) and all(x in nset for x in g.verts)]
        cur = nset
    for f in new_faces:
        f.smooth = True
        for l in f.loops:
            uv0, duv = uvinfo[origin[l.vert]]
            l[uvl].uv = uv0 + duv * (ring[l.vert] * step)
    # face the same way as the hem it continues (no shading seam where the old hem was)
    bm.normal_update()
    before = {f: f.normal.copy() for f in hem_faces}
    bmesh.ops.recalc_face_normals(bm, faces=new_faces + hem_faces)
    bm.normal_update()
    if sum(1 for f in hem_faces if f.normal.dot(before[f]) < 0) > len(hem_faces) / 2:
        bmesh.ops.reverse_faces(bm, faces=new_faces + hem_faces)
    bm.to_mesh(ob.data)
    ids = [v.index for v in new_verts]
    kring = {v.index: ring[v] for v in new_verts}
    bm.free()
    vg = ob.vertex_groups.new(name="_ext")
    vg.add(ids, 1.0, "REPLACE")
    m = ob.modifiers.new("ext_out", "SHRINKWRAP")
    m.target, m.wrap_method, m.wrap_mode, m.offset, m.vertex_group = body, "NEAREST_SURFACEPOINT", "OUTSIDE", 0.005, "_ext"
    apply_first(ob, m)
    # smooth the added fabric (the old hem ring stays put), so it flows on from the hem without a ledge
    nb = {}
    for e in ob.data.edges:
        i, j = e.vertices
        nb.setdefault(i, []).append(j)
        nb.setdefault(j, []).append(i)
    co = {v.index: v.co.copy() for v in ob.data.vertices}
    sid = set(ids)
    for _ in range(6):
        co.update({i: sum((co[j] for j in nb[i]), co[i] * 0) / len(nb[i]) * 0.5 + co[i] * 0.5 for i in sid})
    for i in sid:
        ob.data.vertices[i].co = co[i]
    m = ob.modifiers.new("ext_out2", "SHRINKWRAP")
    m.target, m.wrap_method, m.wrap_mode, m.offset, m.vertex_group = body, "NEAREST_SURFACEPOINT", "OUTSIDE", 0.004, "_ext"
    apply_first(ob, m)
    # the lower it hangs, the more it moves with the legs (weights from the nearest body point), so a bent knee
    # carries the hem along instead of poking through it
    from mathutils import kdtree
    bones = {b.name for b in rig.data.bones}
    kd = kdtree.KDTree(len(body.data.vertices))
    for v in body.data.vertices:
        kd.insert(v.co, v.index)
    kd.balance()
    bname = {g.index: g.name for g in body.vertex_groups if g.name in bones}
    for i in ids:
        v = ob.data.vertices[i]
        t = min(1.0, 1.6 * kring[i] / RINGS)
        new = {ob.vertex_groups[g.group].name: g.weight * (1 - t) for g in v.groups if ob.vertex_groups[g.group].name in bones}
        bw = {}
        for _, j, d in kd.find_n(v.co, 4):
            for g in body.data.vertices[j].groups:
                if g.group in bname:
                    bw[bname[g.group]] = bw.get(bname[g.group], 0) + g.weight / 4
        for n, w in bw.items():
            new[n] = new.get(n, 0) + w * t
        tot = sum(new.values()) or 1
        for g in list(v.groups):
            if ob.vertex_groups[g.group].name in bones:
                ob.vertex_groups[g.group].remove([i])
        for n, w in new.items():
            if w / tot > 0.01:
                (ob.vertex_groups.get(n) or ob.vertex_groups.new(name=n)).add([i], w / tot, "REPLACE")
    print("EXTEND", ob.name, len(ids))
    return set(ids)


EXTENDED = {}
for gid, (ob, name) in garments.items():
    mesh = ob.data
    for m in list(ob.modifiers):
        if m.type == "SUBSURF":   # MPFB leaves the viewport level at 0: subdivide for real (cloth bakes need the final mesh)
            m.show_viewport = True
            m.levels = max(1, m.render_levels)
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier=m.name)
    ext = extend_hem(ob) if gid in ("tee", "long") else set()
    if gid in ("tee", "long"):   # nothing of the top inside the body (the bust showed through the knit)
        m = ob.modifiers.new("clear_body", "SHRINKWRAP")
        m.target, m.wrap_method, m.wrap_mode, m.offset = body, "NEAREST_SURFACEPOINT", "OUTSIDE", 0.004
        apply_first(ob, m)
    EXTENDED[gid] = ext
    ah = mesh.attributes.new("_h", "FLOAT", "POINT")
    asl = mesh.attributes.new("_s", "FLOAT", "POINT")
    if gid in ("tee", "long"):
        axt = mesh.attributes.new("_x", "FLOAT", "POINT")
        for i in ext:
            axt.data[i].value = 1.0
        ob.vertex_groups.remove(ob.vertex_groups["_ext"])
    gidx = {vg.index: vg.name for vg in ob.vertex_groups}
    for v in mesh.vertices:
        w = sum(g.weight for g in v.groups if gidx.get(g.group) in ARM_GROUPS)
        co = ob.matrix_world @ v.co
        ah.data[v.index].value = co.z
        side = "l" if co.x > 0 else "r"
        asl.data[v.index].value = arm_param(co, side) if w > 0.5 and gid in ("tee", "long") else 0.0
    for p in mesh.polygons:
        p.use_smooth = True
    # a second UV map without overlaps (MakeHuman UVs mirror left/right): the site paints and cuts in it
    if gid != "shoes":
        for o in bpy.context.selected_objects:
            o.select_set(False)
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        uv_paint = mesh.uv_layers.new(name="paint")
        mesh.uv_layers.active = uv_paint
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.012, area_weight=1.0, scale_to_bounds=True)
        bpy.ops.object.mode_set(mode="OBJECT")
        mesh.uv_layers.active = mesh.uv_layers[0]
        mesh.uv_layers[0].active_render = True
        ob.select_set(False)

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


def bake_over(ob, target, lift=0.16, start=None):
    ttop = max(v.co.z for v in target.data.vertices)
    orig = [v.co.copy() for v in ob.data.vertices]
    if start:   # start from another shape (a lengthened top) instead of the basis
        for v, c in zip(ob.data.vertices, start):
            v.co = c
    base = [v.co.copy() for v in ob.data.vertices]
    m = ob.modifiers.new("over", "SHRINKWRAP")
    m.target, m.wrap_method, m.wrap_mode, m.offset = target, "NEAREST_SURFACEPOINT", "OUTSIDE", 0.013
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0)
    out = [b.lerp(c, sstep(ttop + lift, ttop - 0.01, b.z)) for b, c in zip(base, evaluated_coords(ob))]
    ob.modifiers.remove(m)
    for v, c in zip(ob.data.vertices, orig):
        v.co = c
    # spread the push out smoothly over the neighbours (no hard step at the waistband), never less than the push itself
    nb = [[] for _ in base]
    for e in ob.data.edges:
        i, j = e.vertices
        nb[i].append(j)
        nb[j].append(i)
    d0 = [o - b for o, b in zip(out, base)]
    d = d0[:]
    for _ in range(160):   # long diffusion: the top rises over a wide waistband gradually, from well above it
        d = [sum((d[j] for j in nb[i]), d[i]) / (len(nb[i]) + 1) for i in range(len(d))]
        d = [x if x.length >= y.length else y for x, y in zip(d, d0)]
    return [b + x for b, x in zip(base, d)]


def bake_relax(ob, ext, band=0.14):
    """A lengthened top: the old hem band (often a tight rib) lets go, so the fabric hangs on smoothly into the added
    length instead of stepping out below the old hem. Smooths ~10 cm above the old hem plus the added part."""
    import heapq
    me = ob.data
    base = [v.co.copy() for v in me.vertices]
    nb = [[] for _ in base]
    for e in me.edges:
        i, j = e.vertices
        nb[i].append(j)
        nb[j].append(i)
    dist = {i: 0.0 for i in range(len(base)) if i not in ext and any(j in ext for j in nb[i])}
    q = [(0.0, i) for i in dist]
    heapq.heapify(q)
    while q:
        d, i = heapq.heappop(q)
        if d > dist.get(i, 9) or d > band:
            continue
        for j in nb[i]:
            if j in ext:
                continue
            nd = d + (base[i] - base[j]).length
            if nd < dist.get(j, 9):
                dist[j] = nd
                heapq.heappush(q, (nd, j))
    w = {i: 1.0 for i in ext}
    w.update({i: sstep(band, band * 0.3, d) for i, d in dist.items() if d < band})
    co = base[:]
    for _ in range(25):   # sideways only: heights stay, so stripes and the rib's tight rows don't smear
        nco = []
        for i in range(len(co)):
            if i in w and nb[i]:
                avg = sum((co[j] for j in nb[i]), co[i] * 0) / len(nb[i])
                c = lerp(co[i], avg, 0.5 * w[i])
                c.z = co[i].z
                nco.append(c)
            else:
                nco.append(co[i])
        co = nco
    for v, c in zip(me.vertices, co):
        v.co = c
    m = ob.modifiers.new("relax_out", "SHRINKWRAP")
    m.target, m.wrap_method, m.wrap_mode, m.offset = body, "NEAREST_SURFACEPOINT", "OUTSIDE", 0.005
    for o in bpy.context.selected_objects:
        o.select_set(False)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_move_to_index(modifier=m.name, index=0)
    out = evaluated_coords(ob)
    ob.modifiers.remove(m)
    for v, b in zip(me.vertices, base):
        v.co = b
    return [b.lerp(c, w.get(i, 0.0)) for i, (b, c) in enumerate(zip(base, out))]


def smooth_delta(ob, base, out, weight, iters=14):
    """Keep a simulated shape's drape but iron out its small crumples (tight rib rows fold up in the cloth sim)."""
    nb = [[] for _ in base]
    for e in ob.data.edges:
        i, j = e.vertices
        nb[i].append(j)
        nb[j].append(i)
    d = [o - b for o, b in zip(out, base)]
    w = [weight(b) for b in base]
    for _ in range(iters):
        d = [d[i].lerp(sum((d[j] for j in nb[i]), d[i] * 0) / len(nb[i]), 0.6 * w[i]) if nb[i] else d[i] for i in range(len(d))]
    return [b + x for b, x in zip(base, d)]


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
        # the shoulders stay on the body (pinned where they are); the extra room starts at the chest and grows down,
        # so an oversized top hangs from the shoulders instead of floating above them
        loose = bake_cloth(ob, lambda b: lerp(0.03 * sstep(top - 0.08, top - 0.24, b.z) + 0.012 * sstep(top - 0.3, bot, b.z), 0.009, aw(b)),
                           lambda b: max(sstep(top - 0.12, top - 0.05, b.z), 0.92 * aw(b)), bend=0.4)
        base = [v.co.copy() for v in ob.data.vertices]
        keys["loose"] = smooth_delta(ob, base, loose, lambda b: lerp(sstep(top - 0.2, top - 0.42, b.z), 0.25, aw(b)))
        # worn out over the trousers / skirt: everything below their waistband goes just outside them
        for low in ("jeans", "skirt"):
            keys["over_" + low] = bake_over(ob, garments[low][0])
        keys["ext"] = bake_relax(ob, EXTENDED[gid])
        keys["ext_jeans"] = bake_over(ob, garments["jeans"][0], start=keys["ext"])   # lengthened and worn out over jeans
        keys["loose_jeans"] = bake_over(ob, garments["jeans"][0], start=keys["loose"])   # oversized and worn out over jeans
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


def upright():
    """Bring the head back over the shoulders (MakeHuman carries it forward): tilt the neck back until the head's
    base sits right above the neck base, then turn the head the other way so the face stays level."""
    ax = Vector((1, 0, 0))
    for _ in range(12):
        bpy.context.view_layer.update()
        err = P["head"].head.y - P["neck_01"].head.y - 0.004   # >0: head behind the neck base (MakeHuman faces -Y)
        if abs(err) < 0.0015:
            break
        rot(P["neck_01"], ax, -SIGN * err * 220)               # degrees per metre of error, sign from the probe above
    for _ in range(12):
        bpy.context.view_layer.update()
        d = (P["head"].tail - P["head"].head).normalized()
        if abs(d.y) < 0.01:
            break
        rot(P["head"], ax, -SIGN * d.y * 50)


def reset():
    for pb in P:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.rotation_mode = "QUATERNION"
    bpy.context.view_layer.update()
    upright()


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


# which way is "back" for an X rotation: the head tail should move toward +Y (MakeHuman faces -Y)
for pb in P:
    pb.rotation_mode = "QUATERNION"
bpy.context.view_layer.update()
y0 = P["head"].tail.y
rot(P["neck_01"], Vector((1, 0, 0)), 5)
SIGN = 1 if P["head"].tail.y > y0 else -1
for pb in P:
    pb.rotation_quaternion = (1, 0, 0, 0)
bpy.context.view_layer.update()
head_fwd = (P["head"].head.y - P["neck_01"].head.y)
NECK_BACK, HEAD_BACK = SIGN * 9, SIGN * 5
print("NECK", round(head_fwd, 3), SIGN)

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
