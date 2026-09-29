import * as THREE from 'three';
export class Bin {
    disposers = [];
    disposed = false;
    /** Registers a teardown callback. Returns it for convenience. */
    add(disposer) {
        if (this.disposed) {
            disposer();
            return disposer;
        }
        this.disposers.push(disposer);
        return disposer;
    }
    listen(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        this.add(() => target.removeEventListener(type, handler, options));
    }
    /** `setTimeout` that is cancelled on disposal. */
    timeout(callback, ms) {
        const id = window.setTimeout(callback, ms);
        this.add(() => window.clearTimeout(id));
        return id;
    }
    /** `setInterval` that is cancelled on disposal. */
    interval(callback, ms) {
        const id = window.setInterval(callback, ms);
        this.add(() => window.clearInterval(id));
        return id;
    }
    /** Registers a three.js object graph for full geometry/material/texture disposal. */
    object3D(object) {
        this.add(() => disposeObject(object));
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        for (let i = this.disposers.length - 1; i >= 0; i--) {
            try {
                this.disposers[i]();
            }
            catch (error) {
                if (false)
                    console.warn('[world] disposer threw', error);
            }
        }
        this.disposers.length = 0;
    }
    get size() {
        return this.disposers.length;
    }
}
const disposedMaterials = new WeakSet();
const disposedGeometries = new WeakSet();
const disposedTextures = new WeakSet();
function disposeMaterial(material) {
    if (disposedMaterials.has(material))
        return;
    disposedMaterials.add(material);
    // Textures hang off arbitrarily named slots; walk the instance.
    for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
            disposedTextures.add(value);
            value.dispose();
        }
    }
    const uniforms = material.uniforms;
    if (uniforms) {
        for (const uniform of Object.values(uniforms)) {
            const value = uniform?.value;
            if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
                disposedTextures.add(value);
                value.dispose();
            }
        }
    }
    material.dispose();
}
/** Recursively frees geometries, materials and textures under `root`. */
export function disposeObject(root) {
    root.traverse((child) => {
        const mesh = child;
        if (mesh.geometry && !disposedGeometries.has(mesh.geometry)) {
            disposedGeometries.add(mesh.geometry);
            mesh.geometry.dispose();
        }
        const material = mesh.material;
        if (Array.isArray(material))
            material.forEach(disposeMaterial);
        else if (material)
            disposeMaterial(material);
    });
    root.removeFromParent();
    root.clear();
}
