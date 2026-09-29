import * as THREE from 'three';
export class Screen {
    group = new THREE.Group();
    mesh;
    canvas;
    context;
    texture;
    width;
    height;
    constructor(options) {
        this.width = options.width;
        this.height = options.height;
        this.canvas = document.createElement('canvas');
        this.canvas.width = options.width;
        this.canvas.height = options.height;
        const context = this.canvas.getContext('2d');
        if (!context)
            throw new Error('World2: 2D canvas is unavailable, so in-world screens cannot be painted.');
        this.context = context;
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.flipY = options.flipY ?? true;
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = 8;
        this.texture.minFilter = THREE.LinearMipmapLinearFilter;
        this.texture.magFilter = THREE.LinearFilter;
        const worldHeight = options.worldWidth * (options.height / options.width);
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(options.worldWidth, worldHeight), new THREE.MeshStandardMaterial({
            map: this.texture,
            emissiveMap: this.texture,
            emissive: new THREE.Color(0xffffff),
            emissiveIntensity: options.emissive ?? 0.55,
            roughness: 0.85,
            metalness: 0,
            transparent: options.transparent ?? false,
            side: THREE.DoubleSide,
            toneMapped: true,
        }));
        this.group.add(this.mesh);
    }
    draw(paint) {
        this.context.save();
        this.context.setTransform(1, 0, 0, 1, 0, 0);
        this.context.clearRect(0, 0, this.width, this.height);
        paint(this.context);
        this.context.restore();
        this.texture.needsUpdate = true;
    }
    /** Wraps `text` to `maxWidth` canvas pixels and returns the lines. */
    wrap(text, maxWidth) {
        const words = text.split(/\s+/);
        const lines = [];
        let line = '';
        for (const word of words) {
            const candidate = line ? `${line} ${word}` : word;
            if (this.context.measureText(candidate).width > maxWidth && line) {
                lines.push(line);
                line = word;
            }
            else
                line = candidate;
        }
        if (line)
            lines.push(line);
        return lines;
    }
    destroy() {
        this.mesh.geometry.dispose();
        this.mesh.material.dispose();
        this.texture.dispose();
        this.group.removeFromParent();
    }
}
