"""
Bake the person of the `human` landmark from the Microsoft Rocketbox avatar Male_Adult_01 (MIT).

Run with Blender (tested with 5.1), from the repo root:

  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build-figure.py -- \
      <rocketbox_dir> <out_dir> [--preview <png_dir>]

<rocketbox_dir> holds Male_Adult_01.fbx (Assets/Avatars/Adults/Male_Adult_01/Export of
https://github.com/microsoft/Microsoft-Rocketbox, MIT). <out_dir> (public/assets/human/figure)
receives figure_high.bin, figure_low.bin and figure.json; the script also writes
src/landmarks/human/figureData.ts (the constants the scene derives its ground and hand frame from).
Then run tools/build-figure-tex.py for the textures. --preview renders quick Workbench views of the
pose instead of baking.

What it does:
  1. imports the rigged FBX and poses the skeleton: standing on the left leg, right upper arm down,
     right forearm level in front, palm down, head bowed looking at the back of the right hand
     (where an ant is walking), left arm relaxed;
  2. evaluates the skinning (dual quaternion) with a corrective smooth on the joints, bakes the pose
     into static geometry, subdivides the body once for the high tier;
  3. bakes ambient occlusion (with a ground plane) into the vertices with Cycles;
  4. scales the man to 1.70 m standing height, levels the back of the right hand so its surface
     normal at the anchor is exactly up, and moves the anchor to the origin;
  5. writes quantised geometry (positions int16, octahedral normals, uv uint16, AO) per tier.

Frames: Blender world (Z up, the man faces −Y, his left is +X) → scene object frame (Y up, he faces
+Z): (x, y, z)_three = (x, z, −y)_blender · scale − anchor. 1 object unit = 1.7 m.
"""
import bpy
import bmesh
import json
import math
import os
import struct
import sys
from mathutils import Matrix, Vector, Quaternion
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC = os.path.abspath(argv[0])
OUT = os.path.abspath(argv[1])
PREVIEW = argv[argv.index('--preview') + 1] if '--preview' in argv else None
REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
HEIGHT_M = 1.70
UNIT = 1.7

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, 'Male_Adult_01.fbx'))
arm = bpy.data.objects['Bip01']
body = [o for o in bpy.data.objects if o.type == 'MESH'][0]
P = arm.pose.bones


def upd():
    bpy.context.view_layer.update()


def W():
    return arm.matrix_world


def hd(n):
    return W() @ P['Bip01 ' + n].head


def wmat(n):
    return W() @ P['Bip01 ' + n].matrix


def rot_world(n, R, pivot=None):
    """Rotate bone n (and its children) by the world rotation R about its head (or pivot)."""
    pb = P['Bip01 ' + n]
    M = W() @ pb.matrix
    p = M.translation.copy() if pivot is None else pivot
    newM = Matrix.Translation(p) @ R.to_4x4() @ Matrix.Translation(-p) @ M
    pb.matrix = W().inverted() @ newM
    upd()


def aim(n, child, d):
    v = (hd(child) - hd(n)).normalized()
    rot_world(n, v.rotation_difference(Vector(d).normalized()).to_matrix())


def twist(n, axis, ang):
    rot_world(n, Matrix.Rotation(ang, 3, Vector(axis).normalized()))


def translate(n, dv):
    pb = P['Bip01 ' + n]
    M = W() @ pb.matrix
    pb.matrix = W().inverted() @ (Matrix.Translation(Vector(dv)) @ M)
    upd()


def deg(a):
    return math.radians(a)


def two_bone_ik(upper, lower, end, target, pole):
    """Place upper→lower→end so that end's head reaches target, bending towards pole."""
    H, K, A = hd(upper), hd(lower), hd(end)
    l1, l2 = (K - H).length, (A - K).length
    d = Vector(target) - H
    dist = min(max(d.length, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-5)
    dh = d.normalized()
    a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
    h = math.sqrt(max(l1 * l1 - a * a, 0))
    pp = Vector(pole) - dh * Vector(pole).dot(dh)
    knee = H + dh * a + pp.normalized() * h
    aim(upper, lower, knee - H)
    aim(lower, end, Vector(target) - hd(lower))


def hand_frame(side):
    """(wrist, along fingers, dorsal normal) from the skeleton of hand side 'R'/'L'."""
    w = hd(side + ' Hand')
    i1, i4 = hd(side + ' Finger1'), hd(side + ' Finger4')
    mid = (i1 + i4 + hd(side + ' Finger2') + hd(side + ' Finger3')) / 4
    f = (mid - w).normalized()
    n = (i4 - i1).cross(f).normalized()
    # the thumb lies on the palm side of the plane of the knuckles
    thumb = hd(side + ' Finger02')
    if (thumb - w).dot(n) > 0:
        n = -n
    return w, f, n, mid


def curl(side, angles, thumb=None):
    _, _, dors, _ = hand_frame(side)
    for k in range(1, 5):
        for j, a in enumerate(angles[k - 1] if isinstance(angles[0], (list, tuple)) else angles):
            n = f'{side} Finger{k}' + ('' if j == 0 else str(j))
            nxt = f'{side} Finger{k}{j + 1}' if j < 2 else None
            b = hd(n)
            tip = hd(nxt) if nxt else b + (b - hd(f'{side} Finger{k}' + ('' if j == 1 else str(j - 1)))).normalized() * 0.02
            v = (tip - b).normalized()
            ax = v.cross(dors).normalized()
            R = Matrix.Rotation(deg(a), 3, ax)
            if (R @ v).dot(dors) > 0:
                R = Matrix.Rotation(-deg(a), 3, ax)
            rot_world(n, R)
    if thumb:
        for j, a in enumerate(thumb):
            n = f'{side} Finger0' + ('' if j == 0 else str(j))
            _, f, dors, _ = hand_frame(side)
            ax = f.cross(dors).normalized()
            R = Matrix.Rotation(deg(a), 3, ax)
            v = ((hd(f'{side} Finger0{j + 1}') if j < 2 else hd(n) + f * 0.02) - hd(n)).normalized()
            if (R @ v).dot(dors) > 0:
                R = Matrix.Rotation(-deg(a), 3, ax)
            rot_world(n, R)


def facing(n, rest_q):
    """Current world forward (−Y at rest) of bone n."""
    q = wmat(n).to_quaternion() @ rest_q.inverted()
    return (q @ Vector((0, -1, 0))).normalized()


# ------------------------------------------------------------------ hair cards follow the skin under them
# (in the source a few nape cards are weighted to the neck differently from the scalp beneath them, so
# a bowed head lifts them off like a flap): copy each card vertex's weights from the nearest scalp vertex
from mathutils.kdtree import KDTree
_hair = set(v for p in body.data.polygons if p.material_index == 2 for v in p.vertices)
_kd = KDTree(len(body.data.vertices))
for v in body.data.vertices:
    if v.index not in _hair:
        _kd.insert(v.co, v.index)
_kd.balance()
for vi in _hair:
    v = body.data.vertices[vi]
    _, src, _ = _kd.find(v.co)
    for g in list(v.groups):
        body.vertex_groups[g.group].remove([vi])
    for g in body.data.vertices[src].groups:
        body.vertex_groups[g.group].add([vi], g.weight, 'REPLACE')


def gather(side, frac):
    """Bring the fingers together (a relaxed hand's fingers touch): turn each about the back-of-hand
    normal towards the middle finger's direction by frac of the angle between them."""
    _, _, dors, _ = hand_frame(side)
    ref = (hd(f'{side} Finger21') - hd(f'{side} Finger2')).normalized()
    for k in (1, 3, 4):
        n = f'{side} Finger{k}'
        v = (hd(n + '1') - hd(n)).normalized()
        vp, rp = (v - dors * v.dot(dors)).normalized(), (ref - dors * ref.dot(dors)).normalized()
        ang = math.atan2(vp.cross(rp).dot(dors), vp.dot(rp))
        rot_world(n, Matrix.Rotation(ang * frac, 3, dors))


# ------------------------------------------------------------------ rest measurements
upd()
REST_Q = {n: wmat(n).to_quaternion() for n in ['Head', 'Neck', 'REye', 'LEye', 'Pelvis']}
FOOT0 = {s: (hd(s + ' Foot').copy(), wmat(s + ' Foot').to_3x3().normalized()) for s in 'LR'}
_rest = [body.matrix_world @ v.co for v in body.data.vertices]
REST_H = max(v.z for v in _rest) - min(v.z for v in _rest)  # standing height in the rest (A) pose, soles to hair
SCALE = HEIGHT_M / REST_H
print('rest height', REST_H, 'scale', SCALE)

# ------------------------------------------------------------------ deformation
mod = [m for m in body.modifiers if m.type == 'ARMATURE'][0]
mod.use_deform_preserve_volume = True
# joints (weights shared between bones) get a corrective smooth
vg = body.vertex_groups.new(name='joints')
for v in body.data.vertices:
    ws = sorted((g.weight for g in v.groups), reverse=True)
    if not ws:
        continue
    j = 1.0 - ws[0]
    if j > 0.02:
        vg.add([v.index], min(1.0, j * 2.2), 'REPLACE')
cs = body.modifiers.new('corr', 'CORRECTIVE_SMOOTH')
cs.factor = 0.6
cs.iterations = 6
cs.smooth_type = 'LENGTH_WEIGHTED'
cs.rest_source = 'ORCO'
cs.vertex_group = 'joints'
cs.use_pin_boundary = True
sub = body.modifiers.new('sub', 'SUBSURF')  # temporary: the hand is levelled on the smooth (high-tier) surface
sub.levels = 1
sub.uv_smooth = 'PRESERVE_BOUNDARIES'
upd()

# ------------------------------------------------------------------ pose
# weight on the left leg: hips shift over it, the right hip drops; shoulders counter-tilt
translate('Pelvis', (0.028, 0.006, -0.012))
rot_world('Pelvis', Matrix.Rotation(deg(-3.5), 3, 'Y') @ Matrix.Rotation(deg(4), 3, 'Z'))
rot_world('Spine1', Matrix.Rotation(deg(3.0), 3, 'Y'))
rot_world('Spine2', Matrix.Rotation(deg(2.0), 3, 'Y') @ Matrix.Rotation(deg(-4), 3, 'Z') @ Matrix.Rotation(deg(-4), 3, 'X'))
# (−X rotation leans the chest forward: he is looking down at his hand)

# legs: the left (standing) foot stays where it was; the right foot steps a little forward and out,
# toes turned out, knee relaxed
for s, dpos, yaw in (('L', Vector((0.0, 0.0, 0.0)), deg(4)), ('R', Vector((-0.035, -0.07, 0.0)), deg(-12))):
    tgt = FOOT0[s][0] + dpos
    two_bone_ik(s + ' Thigh', s + ' Calf', s + ' Foot', tgt, Vector((0, -1, 0)))
    # restore the foot's rest orientation (flat on the ground), turned by yaw
    want = Matrix.Rotation(yaw, 3, 'Z') @ FOOT0[s][1]
    cur = wmat(s + ' Foot').to_3x3().normalized()
    rot_world(s + ' Foot', want @ cur.inverted())

# right arm: upper arm hanging, a little forward and out; forearm level in front, angled in
aim('R UpperArm', 'R Forearm', (-0.15, -0.46, -1.0))
aim('R Forearm', 'R Hand', (0.30, -1.0, 0.0))
w, f, dors, _ = hand_frame('R')
fa = (hd('R Hand') - hd('R Forearm')).normalized()
# hand in line with the forearm, wrist very slightly extended
aim('R Hand', 'R Finger2', fa + Vector((0, 0, 0.06)))
# pronate: back of the hand up. The twist is shared by the forearm and the wrist (dual-quaternion
# skinning keeps the wrist's volume)
w, f, dors, _ = hand_frame('R')
up = Vector((0, 0, 1))
dproj = (dors - fa * dors.dot(fa)).normalized()
uproj = (up - fa * up.dot(fa)).normalized()
ang = math.atan2(dproj.cross(uproj).dot(fa), dproj.dot(uproj))
twist('R Forearm', fa, ang * 0.55)
twist('R Hand', fa, ang * 0.45)
gather('R', 0.75)
curl('R', [[16, 24, 14], [20, 28, 16], [24, 32, 18], [28, 36, 20]], thumb=[8, 10, 10])

# left arm: relaxed at the side, elbow a little bent, palm towards the thigh, fingers curled
aim('L UpperArm', 'L Forearm', (0.13, 0.05, -1.0))
aim('L Forearm', 'L Hand', (0.08, -0.30, -1.0))
fa = (hd('L Hand') - hd('L Forearm')).normalized()
aim('L Hand', 'L Finger2', fa + Vector((0.02, -0.02, 0)))
w, f, dors, _ = hand_frame('L')
want = Vector((1.0, 0.35, 0.0)).normalized()
dproj = (dors - fa * dors.dot(fa)).normalized()
uproj = (want - fa * want.dot(fa)).normalized()
ang = math.atan2(dproj.cross(uproj).dot(fa), dproj.dot(uproj))
twist('L Forearm', fa, ang * 0.6)
twist('L Hand', fa, ang * 0.4)
gather('L', 0.6)
curl('L', [[22, 30, 20], [26, 34, 22], [30, 38, 24], [34, 40, 26]], thumb=[8, 12, 10])


def level_hand(iters=4):
    """Rotate the right hand about the wrist so the back of the hand at the anchor faces exactly up."""
    for _ in range(iters):
        a, n = anchor_point()
        R = n.rotation_difference(Vector((0, 0, 1))).to_matrix()
        rot_world('R Hand', R)


def eval_mesh():
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    mw = ev.matrix_world.copy()
    verts = [mw @ v.co for v in me.vertices]
    polys = [tuple(p.vertices) for p in me.polygons]
    mats = [p.material_index for p in me.polygons]
    ev.to_mesh_clear()
    return verts, polys, mats


def anchor_point():
    """Centre of the back of the right hand: the skin above the middle of the metacarpals."""
    w, f, dors, mid = hand_frame('R')
    p0 = w + (mid - w) * 0.55
    verts, polys, mats = eval_mesh()
    bvh = BVHTree.FromPolygons(verts, [p for p, m in zip(polys, mats) if m == 0])
    hit = bvh.ray_cast(p0 + Vector((0, 0, 0.1)), Vector((0, 0, -1)), 0.3)
    c = hit[0]
    # plane fit (PCA) of the skin within 2.2 cm: the back of the hand's mean orientation
    pts = [v for v in verts if (v - c).length < 0.014 and v.z > c.z - 0.01]
    m = sum(pts, Vector()) / len(pts)
    C = Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
    for v in pts:
        d = v - m
        for i in range(3):
            for j in range(3):
                C[i][j] += d[i] * d[j]
    n = smallest_eigvec(C)
    if n.dot(dors) < 0:
        n = -n
    hit2 = bvh.ray_cast(c + n * 0.05, -n, 0.2)
    return (hit2[0] if hit2[0] else c), n


def smallest_eigvec(C):
    # inverse power iteration on a symmetric 3×3
    M = C.copy()
    for i in range(3):
        M[i][i] += 1e-12
    Mi = M.inverted()
    v = Vector((0.3, 0.5, 0.8))
    for _ in range(60):
        v = (Mi @ v).normalized()
    return v


# head: bow the neck and head towards the back of the right hand; eyes do the rest
a0, _ = anchor_point()
eyes = (hd('REye') + hd('LEye')) / 2
for bone, share in (('Neck', 0.38), ('Head', 0.55)):
    cur = facing(bone, REST_Q[bone])
    eyes = (hd('REye') + hd('LEye')) / 2
    want = (a0 - eyes).normalized()
    q = cur.rotation_difference(want)
    q = Quaternion(q.axis, q.angle * share)
    rot_world(bone, q.to_matrix())
# a slight tilt of the head (ear towards the right shoulder)
rot_world('Head', Matrix.Rotation(deg(-5), 3, facing('Head', REST_Q['Head'])))
level_hand()
a0, n0 = anchor_point()
for e in ('REye', 'LEye'):
    cur = facing(e, REST_Q[e])
    rot_world(e, cur.rotation_difference((a0 - hd(e)).normalized()).to_matrix())
# upper lids follow the downward gaze
for s in ('R', 'L'):
    translate(f'{s}EyeBlinkTop', (0, 0, -0.0028))

a0, n0 = anchor_point()
print('ANCHOR', tuple(a0), 'normal', tuple(n0), 'angle from up (deg)', math.degrees(n0.angle(Vector((0, 0, 1)))))
body.modifiers.remove(sub)
upd()

# ------------------------------------------------------------------ preview renders (pose checks)
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x = 600
    sc.render.resolution_y = 900
    # textures for the workbench
    for mat, tex in zip(body.data.materials, ['m002_body_color.tga', 'm002_head_color.tga', 'm002_opacity_color.tga']):
        nt = mat.node_tree
        img = bpy.data.images.load(os.path.join(SRC, tex))
        bsdf = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
        tn = nt.nodes.new('ShaderNodeTexImage')
        tn.image = img
        nt.links.new(tn.outputs['Color'], bsdf.inputs['Base Color'])
        nt.nodes.active = tn
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = 50
    tgt = Vector((0, 0, 0.9))
    for name, az, el, dist, look in (('front', 0, 5, 4.2, tgt), ('side', 90, 5, 4.2, tgt), ('q3', 35, 12, 4.2, tgt), ('back', 200, 8, 4.2, tgt),
                                      ('handR', 300, 30, 1.2, a0 + Vector((0, 0, 0.12))), ('face', 20, -25, 0.9, hd('Head') + Vector((0, -0.05, 0.05)))):
        d = Vector((math.sin(deg(az)) * math.cos(deg(el)), -math.cos(deg(az)) * math.cos(deg(el)), math.sin(deg(el))))
        cam.location = look + d * dist
        cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, f'pv_{name}.png')
        bpy.ops.render.render(write_still=True)
    print('PREVIEW done')
    sys.exit(0)

# ------------------------------------------------------------------ bake the pose into static meshes
sc = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()
baked_me = bpy.data.meshes.new_from_object(body.evaluated_get(dg))
baked_me.transform(body.matrix_world)
for p in baked_me.polygons:
    p.use_smooth = True
hand_info = hand_frame('R')
FOOTDIR = {s: hd(s + ' Toe0') - hd(s + ' Foot') for s in 'LR'}
body_facing = facing('Pelvis', REST_Q['Pelvis'])
chest = wmat('Spine2').to_quaternion()
head_c = (hd('REye') + hd('LEye')) / 2
bpy.data.objects.remove(body)
bpy.data.objects.remove(arm)


def split_hair(me):
    """→ (body mesh with materials 0/1, hair-card mesh with material 2)."""
    out = []
    for keep in ((0, 1), (2,)):
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index not in keep], context='FACES')
        m = bpy.data.meshes.new('part')
        bm.to_mesh(m)
        bm.free()
        for p in m.polygons:
            p.use_smooth = True
        out.append(m)
    return out


body_me, hair_me = split_hair(baked_me)


def obj(name, me):
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    return o


def subdivided(me, levels):
    o = obj('tmp', me.copy())
    if levels:
        m = o.modifiers.new('sub', 'SUBSURF')
        m.levels = levels
        m.render_levels = levels
        m.uv_smooth = 'PRESERVE_BOUNDARIES'
        m.boundary_smooth = 'ALL'
    d = bpy.context.evaluated_depsgraph_get()
    res = bpy.data.meshes.new_from_object(o.evaluated_get(d))
    bpy.data.objects.remove(o)
    for p in res.polygons:
        p.use_smooth = True
    return res


TIERS = {'high': 1, 'low': 0}
parts = {}
for tier, lv in TIERS.items():
    parts[tier] = {'body': subdivided(body_me, lv), 'hair': hair_me.copy()}

# ------------------------------------------------------------------ anchor on the high mesh, level it exactly
hi = parts['high']['body']
hverts = [v.co.copy() for v in hi.vertices]
bvh = BVHTree.FromPolygons(hverts, [tuple(p.vertices) for p in hi.polygons])
w, f, dors, mid = hand_info
p0 = w + (mid - w) * 0.55
hit = bvh.ray_cast(p0 + Vector((0, 0, 0.1)), Vector((0, 0, -1)), 0.3)
A = hit[0]
pts = [v for v in hverts if (v - A).length < 0.014 and v.z > A.z - 0.01]
m = sum(pts, Vector()) / len(pts)
C = Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
for v in pts:
    d = v - m
    for i in range(3):
        for j in range(3):
            C[i][j] += d[i] * d[j]
N = smallest_eigvec(C)
if N.z < 0:
    N = -N
LEVEL = N.rotation_difference(Vector((0, 0, 1))).to_matrix().to_4x4()
print('final levelling (deg)', math.degrees(N.angle(Vector((0, 0, 1)))))
A = bvh.ray_cast(A + N * 0.05, -N, 0.2)[0]
# Blender world → object frame: level about the anchor, anchor → origin, Z-up → Y-up, scale to 1.7 m, metres → units
TO_OBJ = (Matrix.Scale(SCALE / UNIT, 4)
          @ Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
          @ LEVEL @ Matrix.Translation(-A))
ROT_OBJ = (Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0))) @ LEVEL.to_3x3())
for tier in parts:
    for me in parts[tier].values():
        me.transform(TO_OBJ)
        me.update()


def to_obj(v):
    return TO_OBJ @ Vector(v)


def dir_obj(v):
    return (ROT_OBJ @ Vector(v)).normalized()


# ------------------------------------------------------------------ ambient occlusion (Cycles, with the ground)
gy = min(v.co.y for v in parts['high']['body'].vertices)
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = 96
sc.world = bpy.data.worlds.new('w')
sc.world.light_settings.distance = 0.35 / UNIT
ground = obj('ground', bpy.data.meshes.new('g'))
gm = bmesh.new()
for x, z in ((-3, -3), (-3, 3), (3, 3), (3, -3)):
    gm.verts.new((x, gy, z))  # the meshes are in the object frame (Y up) by now
gm.faces.new(gm.verts)
gm.to_mesh(ground.data)
gm.free()


def bake_ao(me, others):
    o = obj('bake', me)
    occ = [obj('occ', x) for x in others]
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    if not me.materials:
        me.materials.append(bpy.data.materials.new('m'))
    for i in range(len(me.materials)):
        if me.materials[i] is None:
            me.materials[i] = bpy.data.materials.new('m')
    attr = me.color_attributes.new('ao', 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = attr
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    ao = [attr.data[i].color[0] for i in range(len(me.vertices))]
    for x in occ:
        bpy.data.objects.remove(x)
    bpy.data.objects.remove(o)
    return ao


AO = {}
for tier in parts:
    b, h = parts[tier]['body'], parts[tier]['hair']
    AO[(tier, 'body')] = bake_ao(b, [])
    AO[(tier, 'hair')] = bake_ao(h, [b])
    print('AO baked', tier)


# ------------------------------------------------------------------ write
def oct_enc(n):
    l1 = abs(n.x) + abs(n.y) + abs(n.z)
    x, y = n.x / l1, n.y / l1
    if n.z < 0:
        x, y = (1 - abs(y)) * (1 if x >= 0 else -1), (1 - abs(x)) * (1 if y >= 0 else -1)
    return x, y


def build_geo(me, ao, mats):
    """Unique (vertex, uv) corners of the faces with material in mats → arrays."""
    me.calc_loop_triangles()
    uvl = me.uv_layers.active.data
    cn = me.corner_normals
    key2i, P, Nn, UV, AOv, idx = {}, [], [], [], [], []
    for t in me.loop_triangles:
        if t.material_index not in mats:
            continue
        for li in t.loops:
            vi = me.loops[li].vertex_index
            uv = uvl[li].uv
            k = (vi, round(uv.x, 5), round(uv.y, 5))
            i = key2i.get(k)
            if i is None:
                i = key2i[k] = len(P)
                P.append(me.vertices[vi].co.copy())
                Nn.append(Vector(cn[li].vector).normalized())
                UV.append((uv.x, uv.y))
                AOv.append(ao[vi])
            idx.append(i)
    return P, Nn, UV, AOv, idx


def write_tier(tier):
    b, h = parts[tier]['body'], parts[tier]['hair']
    geos = {
        'body': build_geo(b, AO[(tier, 'body')], (0,)),
        'head': build_geo(b, AO[(tier, 'body')], (1,)),
        'hair': build_geo(h, AO[(tier, 'hair')], (2,)),
    }
    allp = [p for g in geos.values() for p in g[0]]
    lo = [min(p[i] for p in allp) for i in range(3)]
    hi_ = [max(p[i] for p in allp) for i in range(3)]
    off = [(lo[i] + hi_[i]) / 2 for i in range(3)]
    scl = [(hi_[i] - lo[i]) / 2 * 1.0001 for i in range(3)]
    buf = bytearray()

    def align():
        while len(buf) % 4:
            buf.append(0)

    desc = {}
    for name, (Pp, Nn, UV, AOv, idx) in geos.items():
        d = {'vertexCount': len(Pp), 'indexCount': len(idx)}
        align(); d['position'] = len(buf)
        for p in Pp:
            buf += struct.pack('<3h', *[max(-32767, min(32767, round((p[i] - off[i]) / scl[i] * 32767))) for i in range(3)])
        align(); d['normal'] = len(buf)
        for n in Nn:
            x, y = oct_enc(n)
            buf += struct.pack('<2h', round(x * 32767), round(y * 32767))
        align(); d['uv'] = len(buf)
        for u, v in UV:
            # flip v for WebGL textures (image row 0 at the top, flipY false)
            buf += struct.pack('<2H', max(0, min(65535, round(u * 65535))), max(0, min(65535, round((1 - v) * 65535))))
        align(); d['aux'] = len(buf)
        for a in AOv:
            buf += struct.pack('<4B', max(0, min(255, round(a * 255))), 0, 0, 0)
        align(); d['index'] = len(buf)
        big = len(Pp) > 65535
        d['indexType'] = 'uint32' if big else 'uint16'
        buf += struct.pack(('<%dI' if big else '<%dH') % len(idx), *idx)
        uvs = [c for uv in UV for c in uv]
        if uvs and (min(uvs) < -1e-3 or max(uvs) > 1.001):
            print('WARNING uv out of range', name, min(uvs), max(uvs))
        desc[name] = d
    align()
    fn = f'figure_{tier}.bin'
    with open(os.path.join(OUT, fn), 'wb') as fh:
        fh.write(buf)
    print(tier, {k: (v['vertexCount'], v['indexCount'] // 3) for k, v in desc.items()}, len(buf), 'bytes')
    return {'file': fn, 'bytes': len(buf), 'quant': {'offset': off, 'scale': scl}, 'geometries': desc}, lo, hi_


os.makedirs(OUT, exist_ok=True)
tiers = {}
bounds = None
for tier in parts:
    tiers[tier], lo, hi_ = write_tier(tier)
    if tier == 'high':
        bounds = {'min': lo, 'max': hi_}

# ------------------------------------------------------------------ the numbers the scene derives from
hb = parts['high']['body']
V = [v.co for v in hb.vertices]
groundY = min(v.y for v in V)
feet = []
for side in (1, -1):  # his left (+x), then right
    sole = [v for v in V if v.y < groundY + 0.025 / UNIT and v.x * side > 0]
    cx = sum(v.x for v in sole) / len(sole)
    cz = sum(v.z for v in sole) / len(sole)
    fd = dir_obj(FOOTDIR['L' if side > 0 else 'R'])
    dx, dz = fd.x / math.hypot(fd.x, fd.z), fd.z / math.hypot(fd.x, fd.z)
    feet += [cx, cz, dx, dz]
top = max(V, key=lambda v: v.y)
# hand frame at the anchor, object frame: x along the fingers (horizontal), y up
tf = dir_obj(f)
tf = Vector((tf.x, 0, tf.z)).normalized()
ta = Vector((0, 1, 0)).cross(tf)  # = normal × tangentFingers
# fit y = a x² + b x z + c z² to the skin within 2.5 cm (x along the fingers, z across)
rows = []
for v in V:
    if v.length < 0.025 / UNIT and v.y > -0.012 / UNIT:
        x, z = v.dot(tf) * UNIT, v.dot(ta) * UNIT
        rows.append((x * x, x * z, z * z, v.y * UNIT))
M3 = Matrix(((0, 0, 0), (0, 0, 0), (0, 0, 0)))
rhs = Vector((0, 0, 0))
for r in rows:
    for i in range(3):
        rhs[i] += r[i] * r[3]
        for j in range(3):
            M3[i][j] += r[i] * r[j]
a_, b_, c_ = M3.inverted() @ rhs
# principal curvatures of the height field (Hessian [[2a, b], [b, 2c]])
tr, det = 2 * a_ + 2 * c_, 4 * a_ * c_ - b_ * b_
disc = math.sqrt(max(tr * tr / 4 - det, 0))
k1, k2 = tr / 2 - disc, tr / 2 + disc  # k1 most curved (most negative)
th = 0.5 * math.atan2(b_, a_ - c_)  # angle of the principal axis of the 2a term from x
kx = a_ * math.cos(th) ** 2 + b_ * math.sin(th) * math.cos(th) + c_ * math.sin(th) ** 2
kz = a_ * math.sin(th) ** 2 - b_ * math.sin(th) * math.cos(th) + c_ * math.cos(th) ** 2
r_along, r_across = -1 / (2 * kx) if kx < 0 else 9.9, -1 / (2 * kz) if kz < 0 else 9.9
print('raw radii', r_along, r_across)
# the skin close-up needs a convex cap: a flat/saddle direction is given a gentle 1 m radius
r_along, r_across = min(max(r_along, 0.05), 1.0), min(max(r_across, 0.03), 1.0)
print('curvature fit: radii along %.3f m, across %.3f m, principal axis %.1f deg' % (r_along, r_across, math.degrees(th)))
gaze = dir_obj(body_facing)
gaze = Vector((gaze.x, 0, gaze.z)).normalized()
manifest = {
    'version': 3,
    'unitMeters': UNIT,
    'source': 'Microsoft Rocketbox Male_Adult_01 (MIT), posed and baked by tools/build-figure.py',
    'tiers': tiers,
    'groundY': groundY,
    'feet': feet,
    'anchor': {'normal': [0, 1, 0], 'tangentFingers': list(tf), 'tangentAcross': list(ta)},
    'anchorRadii': {'alongFingersM': r_along, 'acrossKnucklesM': r_across, 'principalAngleDeg': math.degrees(th)},
    'headTop': list(top),
    'headCentre': list(to_obj(head_c)),
    'gaze': list(gaze),
    'bounds': bounds,
    'heightM': HEIGHT_M,
}
r5 = lambda x: round(x, 5) if isinstance(x, float) else x


def rnd(o):
    if isinstance(o, dict):
        return {k: rnd(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [rnd(v) for v in o]
    return r5(o)


manifest = rnd(manifest)
with open(os.path.join(OUT, 'figure.json'), 'w') as fh:
    json.dump(manifest, fh, indent=1)
ts = f"""/**
 * GENERATED by tools/build-figure.py from the baked figure (public/assets/human/figure/figure.json).
 * Do not edit: re-run the bake. Object units (1 unit = 1.7 m), origin = the anchor on the back of the
 * right hand (surface normal +Y), the man faces +Z before the scene turns him (pose.ts FIG_YAW).
 */
export const FIGURE_DATA = {{
  /** the ground under his shoes */
  groundY: {manifest['groundY']},
  /** per shoe [centreX, centreZ, dirX, dirZ] on the ground, left then right */
  feet: {manifest['feet']},
  /** along the fingers (horizontal) and across the knuckles (= normal × tangentFingers) at the anchor */
  tangentFingers: {manifest['anchor']['tangentFingers']} as [number, number, number],
  tangentAcross: {manifest['anchor']['tangentAcross']} as [number, number, number],
  /** fitted radii of curvature of the skin at the anchor (metres) and the angle of the principal axis from the fingers (degrees) */
  radiiM: {{ alongFingers: {manifest['anchorRadii']['alongFingersM']}, acrossKnuckles: {manifest['anchorRadii']['acrossKnucklesM']} }},
  principalAngleDeg: {manifest['anchorRadii']['principalAngleDeg']},
  /** horizontal direction his body faces */
  gaze: {manifest['gaze']} as [number, number, number],
  headTop: {manifest['headTop']} as [number, number, number],
}};
"""
with open(os.path.join(REPO, 'src/landmarks/human/figureData.ts'), 'w') as fh:
    fh.write(ts)
print('groundY', groundY, 'height check (m)', (top.y - groundY) * UNIT, 'feet', feet)
print('DONE')
