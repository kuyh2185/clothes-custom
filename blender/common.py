"""Shared helpers for the 고쳐 입기 asset pipeline (run inside Blender 4.5, headless).

Bodies come from MPFB (MakeHuman for Blender, CC0 base mesh and targets).
Everything is in metres, Z up, feet on the ground at z = 0.
"""
import math
import os
import sys

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")
PREVIEW = os.path.join(ROOT, "blender", "previews")
os.makedirs(OUT, exist_ok=True)
os.makedirs(PREVIEW, exist_ok=True)


def mpfb():
    """Import MPFB services (the extension is installed for the portable Blender in ~/tools)."""
    import importlib
    base = "bl_ext.user_default.mpfb.services."
    return {name: getattr(importlib.import_module(base + mod), name) for mod, name in [
        ("humanservice", "HumanService"), ("targetservice", "TargetService"), ("objectservice", "ObjectService")]}


def args():
    """Arguments after `--` on the blender command line, as key=value pairs."""
    out = {}
    if "--" in sys.argv:
        for a in sys.argv[sys.argv.index("--") + 1:]:
            k, _, v = a.partition("=")
            out[k] = v
    return out


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# Model bodies: MakeHuman macros (0..1). proportions=1 is the idealised (model) end of the scale.
BODIES = {
    "f": dict(gender=0.0, age=0.5, muscle=0.5, weight=0.38, proportions=1.0, height=0.82, cupsize=0.45, firmness=0.6,
              race=dict(asian=0.5, caucasian=0.4, african=0.1)),
    "m": dict(gender=1.0, age=0.5, muscle=0.62, weight=0.45, proportions=1.0, height=0.9, cupsize=0.5, firmness=0.5,
              race=dict(asian=0.5, caucasian=0.4, african=0.1)),
}


def make_body(kind):
    s = mpfb()
    body = s["HumanService"].create_human(mask_helpers=True, detailed_helpers=False, extra_vertex_groups=True,
                                          feet_on_ground=True, scale=0.1, macro_detail_dict=BODIES[kind])
    body.name = "body_" + kind
    return body


def mannequin_material(finish="black"):
    """Satin display-mannequin finish (black / white / stone)."""
    col = {"black": (0.006, 0.006, 0.007, 1), "white": (0.83, 0.81, 0.78, 1), "stone": (0.45, 0.42, 0.38, 1)}[finish]
    m = bpy.data.materials.new("mannequin_" + finish)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = col
    p.inputs["Roughness"].default_value = 0.5 if finish == "black" else 0.6
    p.inputs["Coat Weight"].default_value = 0.12 if finish == "black" else 0.05
    p.inputs["Coat Roughness"].default_value = 0.4
    return m


def studio(target_z=0.95, cam_dist=5.2, res=(720, 1080), engine="CYCLES", samples=48):
    """Seamless light-grey studio: sweep backdrop, big soft key from front-left, fill, rim — like a product shoot."""
    sc = bpy.context.scene
    sc.render.engine = engine
    if engine == "CYCLES":
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
        sc.cycles.device = "CPU"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Base Contrast"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.75, 0.74, 0.72, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.35
    sc.world = world
    # sweep: floor curving up into a wall behind
    bpy.ops.mesh.primitive_plane_add(size=1)
    sweep = bpy.context.object
    sweep.name = "sweep"
    me = sweep.data
    import bmesh
    bm = bmesh.new()
    # MakeHuman bodies face -Y, so the camera is on -Y and the sweep curves up behind them (+Y)
    prof = [(y, 0.0) for y in [-6, -2, 0, 1.2]] + [(1.2 + 1.5 * math.sin(a), 1.5 - 1.5 * math.cos(a)) for a in [i / 10 * math.pi / 2 for i in range(1, 11)]] + [(2.7, 6)]
    rows = []
    for (y, z) in prof:
        rows.append([bm.verts.new((x, y, z)) for x in (-8, 8)])
    for a, b in zip(rows, rows[1:]):
        bm.faces.new((a[0], b[0], b[1], a[1]))
    bm.to_mesh(me)
    bm.free()
    bpy.ops.object.shade_smooth()
    mat = bpy.data.materials.new("paper")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.78, 0.77, 0.75, 1)
    mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
    me.materials.append(mat)

    def area(name, loc, size, energy, rot):
        bpy.ops.object.light_add(type="AREA", location=loc, rotation=rot)
        l = bpy.context.object
        l.name = name
        l.data.size = size
        l.data.energy = energy
        return l
    def aimed(name, loc, size, energy):
        l = area(name, loc, size, energy, (0, 0, 0))
        look_at(l, (0, 0, target_z))
        return l
    aimed("key", (-2.4, -3.0, 3.4), 2.6, 950)
    aimed("fill", (2.9, -2.6, 1.7), 3.2, 280)
    aimed("rim", (0.8, 2.4, 3.1), 1.6, 480)
    bpy.ops.object.camera_add(location=(0, -cam_dist, target_z * 1.06))
    cam = bpy.context.object
    cam.data.lens = 70
    look_at(cam, (0, 0, target_z))
    sc.camera = cam
    return cam


def look_at(obj, target):
    from mathutils import Vector
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
