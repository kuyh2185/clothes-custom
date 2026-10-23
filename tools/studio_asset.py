"""The studio's own mannequin file: assets/studio_<kind>.glb, cut down from the full asset (assets/body_<kind>.glb,
made by blender/export_web.py, still used as it is by legacy/). The studio sews its tops as cloth, so it keeps only the
body (bones, skin, the poses), the jeans and the shoes; the baked garments with their fit shapes and textures go.

    python tools/studio_asset.py        (from the repo root; no packages needed)

Only the glTF's JSON is rewritten: the kept meshes' Draco data is copied byte for byte, never re-encoded, so the
mannequin is exactly the one the full asset has (a re-encode reorders and welds vertices, and the cloth settles
differently on it).
"""
import json
import os
import struct

KEEP = {'body', 'jeans', 'shoes'}


def read_glb(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    m = struct.unpack('<I', b[20 + n:24 + n])[0]
    return j, b[28 + n:28 + n + m]


def write_glb(path, j, bin_):
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    bin_ += b'\0' * (-len(bin_) % 4)
    total = 12 + 8 + len(js) + 8 + len(bin_)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(bin_), 0x004E4942) + bin_)


def renumber(items, used):
    """keep the used entries in order; old index -> new index"""
    old = sorted(used)
    return [items[i] for i in old], {o: n for n, o in enumerate(old)}


def slim(j, bin_):
    nodes = j['nodes']
    gone = {i for i, n in enumerate(nodes) if 'mesh' in n and n.get('name') not in KEEP}
    # nodes: everything but the dropped garments (bones, rig, body, jeans, shoes)
    nodes, nmap = renumber(nodes, set(range(len(nodes))) - gone)
    for n in nodes:
        if 'children' in n:
            n['children'] = [nmap[c] for c in n['children'] if c not in gone]
    for s in j['scenes']:
        s['nodes'] = [nmap[c] for c in s['nodes'] if c not in gone]
    for sk in j.get('skins', []):
        sk['joints'] = [nmap[c] for c in sk['joints']]
        if 'skeleton' in sk:
            sk['skeleton'] = nmap[sk['skeleton']]
    for a in j.get('animations', []):
        a['channels'] = [c for c in a['channels'] if c['target'].get('node') not in gone]
        for c in a['channels']:
            c['target']['node'] = nmap[c['target']['node']]
    j['nodes'] = nodes

    # meshes of the kept nodes; the jeans lose their fit shapes and distressed colour map (the studio draws plain
    # denim over the normal map)
    meshes, mmap = renumber(j['meshes'], {n['mesh'] for n in nodes if 'mesh' in n})
    for n in nodes:
        if 'mesh' in n:
            n['mesh'] = mmap[n['mesh']]
            if n.get('name') == 'jeans':
                me = meshes[n['mesh']]
                me.pop('weights', None)
                me.pop('extras', None)
                for p in me['primitives']:
                    p.pop('targets', None)
                    p['_jeans'] = True
    j['meshes'] = meshes

    mats, matmap = renumber(j['materials'], {p['material'] for m in meshes for p in m['primitives'] if 'material' in p})
    for m in meshes:
        for p in m['primitives']:
            if 'material' in p:
                p['material'] = matmap[p['material']]
            if p.pop('_jeans', False):
                mats[p['material']]['pbrMetallicRoughness'].pop('baseColorTexture', None)
    j['materials'] = mats

    # textures → images / samplers
    def tex_refs(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k.endswith('Texture') and isinstance(v, dict) and 'index' in v:
                    yield v
                else:
                    yield from tex_refs(v)
        elif isinstance(o, list):
            for v in o:
                yield from tex_refs(v)
    refs = list(tex_refs(mats))
    texs, tmap = renumber(j.get('textures', []), {r['index'] for r in refs})
    for r in refs:
        r['index'] = tmap[r['index']]
    src = lambda t: t.get('extensions', {}).get('EXT_texture_webp', {}).get('source', t.get('source'))
    imgs, imap = renumber(j.get('images', []), {src(t) for t in texs})
    smps, smap = renumber(j.get('samplers', []), {t['sampler'] for t in texs if 'sampler' in t})
    for t in texs:
        if 'source' in t:
            t['source'] = imap[t['source']]
        if 'EXT_texture_webp' in t.get('extensions', {}):
            t['extensions']['EXT_texture_webp']['source'] = imap[t['extensions']['EXT_texture_webp']['source']]
        if 'sampler' in t:
            t['sampler'] = smap[t['sampler']]
    j['textures'], j['images'], j['samplers'] = texs, imgs, smps

    # accessors still referred to
    used = set()
    for m in meshes:
        for p in m['primitives']:
            used |= set(p['attributes'].values())
            if 'indices' in p:
                used.add(p['indices'])
    for sk in j.get('skins', []):
        if 'inverseBindMatrices' in sk:
            used.add(sk['inverseBindMatrices'])
    for a in j.get('animations', []):
        a['samplers'], amap = renumber(a['samplers'], {c['sampler'] for c in a['channels']})
        for c in a['channels']:
            c['sampler'] = amap[c['sampler']]
        for s in a['samplers']:
            used |= {s['input'], s['output']}
    accs, amap = renumber(j['accessors'], used)
    for m in meshes:
        for p in m['primitives']:
            p['attributes'] = {k: amap[v] for k, v in p['attributes'].items()}
            if 'indices' in p:
                p['indices'] = amap[p['indices']]
    for sk in j.get('skins', []):
        if 'inverseBindMatrices' in sk:
            sk['inverseBindMatrices'] = amap[sk['inverseBindMatrices']]
    for a in j.get('animations', []):
        for s in a['samplers']:
            s['input'], s['output'] = amap[s['input']], amap[s['output']]
    j['accessors'] = accs

    # buffer views → one packed binary chunk
    bv_refs = []
    for a in accs:
        if 'bufferView' in a:
            bv_refs.append((a, 'bufferView'))
        for k in ('indices', 'values'):
            if k in a.get('sparse', {}):
                bv_refs.append((a['sparse'][k], 'bufferView'))
    for m in meshes:
        for p in m['primitives']:
            d = p.get('extensions', {}).get('KHR_draco_mesh_compression')
            if d:
                bv_refs.append((d, 'bufferView'))
    for im in imgs:
        if 'bufferView' in im:
            bv_refs.append((im, 'bufferView'))
    views, vmap = renumber(j['bufferViews'], {o[k] for o, k in bv_refs})
    out = bytearray()
    for v in views:
        out += b'\0' * (-len(out) % 4)
        off = v.get('byteOffset', 0)
        chunk = bin_[off:off + v['byteLength']]
        v['byteOffset'] = len(out)
        out += chunk
    for o, k in bv_refs:
        o[k] = vmap[o[k]]
    j['bufferViews'] = views
    j['buffers'] = [{'byteLength': len(out)}]
    return j, bytes(out)


if __name__ == '__main__':
    for kind in 'fm':
        src, dst = f'assets/body_{kind}.glb', f'assets/studio_{kind}.glb'
        j, b = slim(*read_glb(src))
        write_glb(dst, j, b)
        print(f'{dst}: {os.path.getsize(src) / 1048576:.1f} MB -> {os.path.getsize(dst) / 1048576:.2f} MB |',
              'nodes', len(j['nodes']), '| meshes', [m['name'] for m in j['meshes']],
              '| animations', [a['name'] for a in j.get('animations', [])], '| images', [i.get('name') for i in j['images']])
