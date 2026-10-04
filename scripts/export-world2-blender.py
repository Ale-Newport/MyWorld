"""Export the actual level. Run via npm run world2:export. Never saves the blend."""
import bpy
import json
import math
import os
import re
import runpy
import hashlib
import base64
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public/world2'
SOURCE = ROOT / 'folio-2025.blend'
B = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
WORLD2_SCALE = 1.0  # Both Blender and the unchanged driving engine use metres.
HELPER = re.compile(r'^(cuboid|tube|ball|hull|trimesh|COLLIDER_)', re.I)


def flat(m):
    return [float(m[r][c]) for c in range(4) for r in range(4)]


def web(v):
    return [float(v.x), float(v.z), -float(v.y)]


def props(o):
    return {k: o[k] for k in o.keys() if k not in ['cycles', '_RNA_UI']}


def ancestors(o):
    while o:
        yield o
        o = o.parent


def descendants(c):
    return {o for child in [c, *c.children_recursive] for o in child.objects}


def category(o):
    cols = {c.name for c in o.users_collection}
    if o.name == 'terrain': return 'terrain'
    if cols & {'road', 'road.001', 'jump', 'bridges', 'rails'}: return 'roads'
    if any('waterfall' in (m.name.lower() if m else '') for m in getattr(o.data, 'materials', [])): return 'water'
    if cols & {'bushes', 'flowers', 'grass'} or o.get('w2Tree'): return 'vegetation'
    return 'scenery'


def new_pbr(name, color, roughness=1):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = color
    p.inputs['Roughness'].default_value = roughness
    m.diffuse_color = color
    return m


def main():
    before = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    runpy.run_path(str(ROOT / 'scripts/world2_blender_audit.py'))
    audit = json.loads((ROOT / 'world2-blender-audit.json').read_text())
    (OUT / 'models').mkdir(parents=True, exist_ok=True)
    (OUT / 'textures').mkdir(exist_ok=True)
    dependencies = json.loads((ROOT / 'assets/world2-source/dependencies.json').read_text())
    recovered = {e['image']: e for e in dependencies['images']}
    resolution = []
    for img in bpy.data.images:
        if img.packed_file or not img.filepath: continue
        original = Path(bpy.path.abspath(img.filepath))
        target = original if original.is_file() else ROOT / 'assets/world2-source' / recovered.get(img.name, {}).get('file', '__missing__')
        if not target.is_file(): raise RuntimeError(f'Missing Blender dependency: {img.name} ({img.filepath})')
        img.filepath = str(target)
        img.reload()
        resolution.append(dict(image=img.name, file=str(target.relative_to(ROOT)) if target.is_relative_to(ROOT) else str(target), sha256=hashlib.sha256(target.read_bytes()).hexdigest()))
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    scene = bpy.context.scene
    area_col = bpy.data.collections['areas']
    area_names = [c.name for c in area_col.children]
    excluded = set()
    exclusion = {}
    for c in bpy.data.collections:
        if c.name in ['map', 'vehicle', 'whispersForbiddenAreas', 'tornado'] or c.name.lower().startswith('archive'):
            for o in descendants(c): excluded.add(o); exclusion[o.name] = 'editor/archive/prototype-only collection: ' + c.name
    tree_sources = set()
    tree_clones = []
    tree_counts = {}
    for kind in ['birchTrees', 'oakTrees', 'cherryTrees']:
        col = bpy.data.collections[kind]
        visual = next(c for c in col.children if c.name.startswith('visual'))
        refs = next(c for c in col.children if c.name.startswith('references'))
        tree_sources |= descendants(col)
        tree_counts[kind] = len(refs.objects)
        for ref in refs.objects:
            group = bpy.data.objects.new('VEGETATION_' + ref.name, None)
            scene.collection.objects.link(group)
            group.matrix_world = ref.matrix_world.copy()
            group['w2Role'] = 'tree'
            group['w2Source'] = ref.name
            group['w2Category'] = 'vegetation'
            tree_clones.append(group)
            for template in visual.objects:
                if template.type != 'MESH': continue
                clone = template.copy()
                clone.name = ref.name + '__' + template.name
                clone.parent = group
                clone.matrix_parent_inverse = Matrix.Identity(4)
                clone.matrix_basis = template.matrix_world.copy()
                clone['w2Source'] = template.name
                clone['w2Tree'] = True
                clone['w2Category'] = 'vegetation'
                clone['w2Role'] = 'visual'
                clone['w2Trunk'] = template.name.startswith('treeBody')
                scene.collection.objects.link(clone)
                tree_clones.append(clone)
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    excluded |= tree_sources
    for o in tree_sources: exclusion[o.name] = 'canonical tree prototype/reference; reconstructed at original reference matrices'
    # Preserve every generated grass blade. This is already one batched mesh,
    # only 65,911 triangles in this file, rather than thousands of draw calls.
    selected = []
    helpers = []
    for o in list(scene.objects):
        if o in excluded: continue
        if o.name not in bpy.context.view_layer.objects:
            exclusion[o.name] = 'excluded from source view layer'; continue
        if o.type in ['CAMERA', 'LIGHT', 'ARMATURE', 'META']:
            exclusion[o.name] = 'editor camera/light or source rig'; continue
        if o.name.lower().startswith(('archive', 'refcheckpoint', 'refintersect')):
            exclusion[o.name] = 'archive or interaction/query-only reference'; continue
        helper = bool(HELPER.match(o.name)) and any('physical' in p.name.lower() for p in ancestors(o.parent))
        # Preserve authored hidden collider meshes; render visibility is not physics intent.
        if o.hide_render and not helper and o.name != 'refRailsPhysicalFixed':
            exclusion[o.name] = 'hidden in source render'; continue
        if o.type == 'CURVE' and not o.data.bevel_depth and not o.data.extrude:
            exclusion[o.name] = 'path metadata, not render geometry'; continue
        o['w2Source'] = o.get('w2Source', o.name)
        o['w2Category'] = category(o)
        o['w2Collections'] = [c.name for c in o.users_collection]
        if helper:
            o['w2Role'] = 'collider'
            o['w2Shape'] = HELPER.match(o.name).group(1).lower()
            o['w2DisplaySize'] = o.empty_display_size
            helpers.append(o)
        elif o.name.startswith(('respawn', 'SPAWN_')):
            o['w2Role'] = 'spawn'
        elif o.name in area_names or o.name.startswith(('AREA_', 'INTERACTIVE_', 'refInteractivePoint', 'refZone')):
            o['w2Role'] = 'area' if o.name in area_names or o.name.startswith('AREA_') else 'reference'
        elif 'physical' in o.name.lower():
            o['w2Role'] = 'physical'
            o['w2Body'] = 'dynamic' if 'dynamic' in o.name.lower() else 'fixed'
        else:
            o['w2Role'] = o.get('w2Role', 'visual' if o.type in ['MESH','CURVE','FONT'] else 'reference')
        if o.type in ['MESH','CURVE','FONT'] and not helper:
            ev = o.evaluated_get(deps)
            mesh = o.data if o.type == 'MESH' and not o.modifiers else bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=deps)
            if not len(mesh.polygons):
                bpy.data.meshes.remove(mesh); exclusion[o.name] = 'no evaluated faces'; continue
            # Freeze modifier output only in memory; source stays editable.
            if o.type != 'MESH':
                bpy.ops.object.select_all(action='DESELECT'); o.hide_set(False);o.select_set(True);bpy.context.view_layer.objects.active=o
                bpy.ops.object.convert(target='MESH')
            o.modifiers.clear()
            o.data = mesh
        selected.append(o)
    # Parents keep source matrices and names; helpers are not thrown away.
    for o in list(selected):
        for parent in ancestors(o.parent):
            if parent not in selected and parent not in excluded: selected.append(parent)
    selected_set = set(selected)
    # The original terrain shader is a Blender-only node graph. Bake its actual
    # Base Color expression in Blender, without lighting, onto the original UVs.
    terrain = bpy.data.objects['terrain']
    material = bpy.data.materials['terrain']
    nodes, links = material.node_tree.nodes, material.node_tree.links
    principal = nodes.get('Principled BSDF')
    original_color = principal.inputs['Base Color'].links[0].from_socket
    output = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output)
    emission = nodes.new('ShaderNodeEmission'); links.new(original_color, emission.inputs[0]);links.new(emission.outputs[0], output.inputs['Surface'])
    baked = bpy.data.images.new('world2-terrain-baked', width=1024, height=1024)
    tex = nodes.new('ShaderNodeTexImage');tex.image=baked;nodes.active=tex
    for n in nodes:n.select = n==tex
    for o in scene.objects:o.select_set(False)
    terrain.hide_set(False);terrain.select_set(True);bpy.context.view_layer.objects.active=terrain
    scene.render.engine='CYCLES';scene.cycles.samples=1;scene.cycles.device='CPU'
    scene.render.bake.target='IMAGE_TEXTURES';scene.render.bake.use_selected_to_active=False
    bpy.ops.object.bake(type='EMIT', margin=8)
    baked.filepath_raw=str(OUT/'textures/terrain-color.png');baked.file_format='PNG';baked.save()
    links.new(principal.outputs[0],output.inputs['Surface'])
    links.new(tex.outputs['Color'],principal.inputs['Base Color'])
    nodes.remove(emission)
    # Trees use palette UVs for trunks; leaf placeholder polyhedra are source
    # foliage volumes. Keep those actual low-poly meshes and species colours.
    leaf_colors={'birchTrees':(0.48,0.61,0.045,1),'oakTrees':(0.19,0.36,0.055,1),'cherryTrees':(0.86,0.22,0.37,1)}
    for kind,color in leaf_colors.items():
        mat=new_pbr('world2-'+kind+'-leaves',color)
        refs=next(c for c in bpy.data.collections[kind].children if c.name.startswith('references'))
        prefixes={r.name+'__' for r in refs.objects}
        for o in tree_clones:
            if o.type=='MESH' and 'treeLeaves' in o.name and any(o.name.startswith(p) for p in prefixes):o.data.materials.clear();o.data.materials.append(mat)
    # Grass's UV-based shader is represented with its own authored two colours.
    # A flat base uses the shader's RGB colour; no geometry or placement changes.
    grass_mat=bpy.data.materials.get('grass')
    if grass_mat:
        p=grass_mat.node_tree.nodes.get('Principled BSDF')
        for link in list(p.inputs['Base Color'].links):grass_mat.node_tree.links.remove(link)
        p.inputs['Base Color'].default_value=grass_mat.node_tree.nodes['RGB'].outputs[0].default_value
        grass_mat.use_backface_culling=False
    # Other materials with no Principled node are Blender emission effects.
    for mat in bpy.data.materials:
        if mat.use_nodes and 'RadialGradient' in mat.name:
            rgb=next((n for n in mat.node_tree.nodes if n.type=='RGB'),None)
            if rgb:
                color=list(rgb.outputs[0].default_value);replacement=new_pbr('world2-'+mat.name,color)
                p=replacement.node_tree.nodes.get('Principled BSDF');p.inputs['Emission Color'].default_value=color;p.inputs['Emission Strength'].default_value=0.45
                for o in selected:
                    for slot in o.material_slots:
                        if slot.material==mat:slot.material=replacement
    bpy.context.view_layer.update()
    bounds = {}
    for o in selected:
        if o.type!='MESH' or o in helpers:continue
        pts=[o.matrix_world@v.co for v in o.data.vertices]
        bounds[o.name]={'min':[min(web(p)[i] for p in pts) for i in range(3)],'max':[max(web(p)[i] for p in pts) for i in range(3)],'vertices':len(o.data.vertices),'triangles':sum(len(p.vertices)-2 for p in o.data.polygons)}
    spawns=[]
    for o in selected:
        if o.get('w2Role')!='spawn':continue
        m=B@o.matrix_world@B.inverted();forward=m.to_3x3()@Vector((1,0,0))
        spawns.append(dict(name=o.name,position=web(o.matrix_world.translation),rotation=math.atan2(-forward.z,forward.x)))
    areas=[]
    for col in area_col.children:
        objs=[o for o in col.all_objects if o in selected_set]
        ref=next((o for o in objs if o.name.startswith('refZoneBounding')),None)
        anchor=next((o for o in objs if o.name==col.name),None)
        if not anchor:continue
        areas.append(dict(name=col.name,anchor=anchor.name,zone=ref.name if ref else None))
    # Follow the ACTUAL road ribbon topology. curveRoad is a hidden legacy
    # construction guide whose bounds extend beyond this level; it is audited,
    # but must not become a second source of runtime map coordinates.
    road_paths=[]
    road_mesh=bpy.data.objects.get('refRoad')
    if road_mesh and road_mesh.type=='MESH':
        from collections import defaultdict
        mesh=road_mesh.data
        edges=defaultdict(list)
        for face in mesh.polygons:
            for edge in face.edge_keys:edges[tuple(sorted(edge))].append(face.index)
        adjacent=defaultdict(list)
        for edge,faces in edges.items():
            if len(faces)==2:
                adjacent[faces[0]].append((faces[1],edge));adjacent[faces[1]].append((faces[0],edge))
        first=next((f.index for f in mesh.polygons if len(adjacent[f.index])==1),0)
        current=first;previous=None;visited=set();points=[]
        def midpoint(edge):return web(road_mesh.matrix_world@((mesh.vertices[edge[0]].co+mesh.vertices[edge[1]].co)*.5))
        shared=adjacent[first][0][1]
        cap=next(edge for edge in mesh.polygons[first].edge_keys if not set(edge)&set(shared))
        points.append(midpoint(cap))
        while current not in visited:
            visited.add(current)
            next_edges=[(f,e) for f,e in adjacent[current] if f!=previous]
            if not next_edges:
                end=next(edge for edge in mesh.polygons[current].edge_keys if not set(edge)&set(shared));points.append(midpoint(end));break
            following,shared=next_edges[0];points.append(midpoint(shared));previous,current=current,following
        road_paths.append(dict(name='refRoad-ribbon-centre',closed=(Vector(points[0])-Vector(points[-1])).length<.01,points=points))
    # Split vegetation from required physical map. Both retain source transforms.
    veg={o for o in selected if o.get('w2Category')=='vegetation'}
    for o in list(veg):
        for p in ancestors(o.parent):
            if p in selected_set:veg.add(p)
    core=[o for o in selected if o not in veg]
    def export(name,objects):
        for o in scene.objects:o.select_set(False)
        for o in objects:o.hide_set(False);o.hide_viewport=False;o.hide_render=False;o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(OUT/'models'/name),export_format='GLB',use_selection=True,export_apply=False,export_extras=True,export_yup=True,export_animations=False,export_cameras=False,export_lights=False,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_image_format='AUTO',export_keep_originals=False)
    export('world.glb',core)
    export('vegetation.glb',list(veg))
    # Full geometry map, generated from the evaluated source meshes, x/-y up.
    terrain_bounds=bounds['terrain'];low=terrain_bounds['min'];high=terrain_bounds['max']
    paths=[]
    map_colors={'terrain':'#b0b54a','roads':'#d1b18c','water':'#69b6b2','scenery':'#716750','vegetation':'#5d873a'}
    for o in sorted(selected,key=lambda o: 0 if o.name=='terrain' else 1):
        if o.type!='MESH' or o in helpers or o.name in ['Plane.003','terrain']:continue
        coords=[web(o.matrix_world@v.co) for v in o.data.vertices]
        polygons=[]
        for p in o.data.polygons:
            # Skip vertical faces and underside faces in the top view.
            n=o.matrix_world.to_3x3()@p.normal
            if n.z < .15:continue
            polygons.append('M'+'L'.join(f'{coords[i][0]:.3f},{coords[i][2]:.3f}' for i in p.vertices)+'Z')
        if polygons:paths.append(f'<path fill="{map_colors.get(o.get("w2Category"),"#716750")}" d="'+''.join(polygons)+'"/>')
    encoded=base64.b64encode((OUT/'textures/terrain-color.png').read_bytes()).decode('ascii')
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{low[0]} {low[2]} {high[0]-low[0]} {high[2]-low[2]}"><image x="{low[0]}" y="{low[2]}" width="{high[0]-low[0]}" height="{high[2]-low[2]}" href="data:image/png;base64,{encoded}"/>'+''.join(paths)+'</svg>'
    (OUT/'map.svg').write_text(svg)
    manifest=dict(version=1,source=SOURCE.name,sourceSha256=before,scale=WORLD2_SCALE,coordinateConversion='glTF Y-up: (x, y, z) -> (x, z, -y)',blenderVersion=bpy.app.version_string,models=['/world2/models/world.glb','/world2/models/vegetation.glb'],bounds=terrain_bounds,spawn='respawnLanding',spawns=spawns,areas=areas,roadPaths=road_paths,treeCounts=tree_counts,waterLevel=-.3,waterLevelSource='Companion source Game/Water.js; surface clipped by the original terrainWater displacement',stats=dict(coreObjects=len(core),vegetationObjects=len(veg),colliderHelpers=len(helpers),triangles=sum(b['triangles'] for b in bounds.values())),validationBounds={k:v for k,v in bounds.items() if k in ['terrain','refRoad','bridgePhysicalFixed','bridgePhysicalFixed.001','jump','Plane.003']})
    (OUT/'world-manifest.json').write_text(json.dumps(manifest,indent=2))
    audit['export']={'sourceSha256':before,'resolvedDependencies':resolution,'excluded':exclusion,'evaluatedBounds':bounds,'manifest':manifest,'materialTranslations':['terrain Base Color baked in Blender Cycles EMIT, 1024px','tree leaf volumes keep source meshes with species foliage colours','grass uses authored RGB green','emission graph effects translated to PBR emission'],'sourceUnmodified':hashlib.sha256(SOURCE.read_bytes()).hexdigest()==before}
    (ROOT/'world2-blender-audit.json').write_text(json.dumps(audit,indent=2))
    # Optional Blender reference render after export, without helpers/editor duplicates.
    if '--render-reference' in __import__('sys').argv:
        for o in scene.objects:o.hide_render=o not in selected_set or o in helpers or o.type not in ['MESH','FONT']
        cam_data=bpy.data.cameras.new('world2-audit-camera');cam=bpy.data.objects.new('world2-audit-camera',cam_data);scene.collection.objects.link(cam)
        cam.location=(0,0,240);cam.rotation_euler=(0,0,0);cam_data.type='ORTHO';cam_data.ortho_scale=200;scene.camera=cam
        scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO';scene.display.shading.color_type='TEXTURE';scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True
        scene.render.image_settings.file_format='PNG';scene.render.use_compositing=False;scene.render.use_sequencer=False
        scene.render.resolution_x=1400;scene.render.resolution_y=1400;scene.render.resolution_percentage=100
        ref_dir=ROOT/'.qa/world2';ref_dir.mkdir(parents=True,exist_ok=True);scene.render.filepath=str(ref_dir/'blender-top.png');bpy.ops.render.render(write_still=True)
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==before,'Source blend changed!'
    print('[world2] COMPLETE',json.dumps(manifest['stats']))

if __name__=='__main__':main()
