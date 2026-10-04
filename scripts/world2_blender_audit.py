import bpy,json,os,collections
from mathutils import Vector
scene=bpy.context.scene
def clean(x):
    if hasattr(x,'to_dict'): return x.to_dict()
    if hasattr(x,'to_list'): return x.to_list()
    try: json.dumps(x); return x
    except: return str(x)
def audit(o):
    corners=[o.matrix_world@Vector(p) for p in o.bound_box]
    return dict(name=o.name,type=o.type,collections=[c.name for c in o.users_collection],parent=o.parent.name if o.parent else None,position=list(o.location),rotation=list(o.rotation_euler),rotation_mode=o.rotation_mode,scale=list(o.scale),matrix_world=[list(r) for r in o.matrix_world],dimensions=list(o.dimensions),bounds=dict(min=[min(p[i] for p in corners) for i in range(3)],max=[max(p[i] for p in corners) for i in range(3)]),materials=[m.name if m else None for m in getattr(o.data,'materials',[])],custom_properties={k:clean(o[k]) for k in o.keys()},hide_render=o.hide_render,hide_viewport=o.hide_viewport,hidden=o.hide_get(),visible=o.visible_get(),mesh=o.data.name if o.type=='MESH' else None,vertices=len(o.data.vertices) if o.type=='MESH' else 0,polygons=len(o.data.polygons) if o.type=='MESH' else 0,instance_type=o.instance_type,instance_collection=o.instance_collection.name if o.instance_collection else None,modifiers=[{'name':m.name,'type':m.type} for m in o.modifiers])
a=dict(source=bpy.data.filepath,blender=bpy.app.version_string,scene=scene.name,units=dict(system=scene.unit_settings.system,scale_length=scene.unit_settings.scale_length,length_unit=scene.unit_settings.length_unit),collections=[dict(name=c.name,parents=[p.name for p in bpy.data.collections if c.name in p.children],objects=[o.name for o in c.objects],children=[x.name for x in c.children],hide_render=c.hide_render,hide_viewport=c.hide_viewport) for c in bpy.data.collections],objects=[audit(o) for o in scene.objects],materials=[dict(name=m.name,diffuse_color=list(m.diffuse_color),use_nodes=m.use_nodes,nodes=[dict(name=n.name,type=n.type,image=n.image.name if n.type=='TEX_IMAGE' and n.image else None) for n in m.node_tree.nodes] if m.use_nodes else []) for m in bpy.data.materials],images=[dict(name=i.name,filepath=i.filepath,absolute=bpy.path.abspath(i.filepath),packed=bool(i.packed_file),exists=os.path.exists(bpy.path.abspath(i.filepath)),size=list(i.size)) for i in bpy.data.images])
with open(os.path.join(os.path.dirname(os.path.dirname(__file__)), 'world2-blender-audit.json'),'w') as f: json.dump(a,f,indent=2)
print('[world2] audited', len(a['objects']), 'objects')
