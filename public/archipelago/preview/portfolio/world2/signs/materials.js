import * as THREE from 'three';
import { PALETTE_HEX, SWATCH_COUNT } from './palette.js';
export const FACE_EMISSIVE = 0.4;
export function findPaletteMaterial(root) {
    let found = null;
    root?.traverse(node => {
        if (found || !node.isMesh)
            return;
        const material = node.material;
        for (const m of Array.isArray(material) ? material : [material]) {
            if (m instanceof THREE.MeshStandardMaterial && m.map?.name === 'palette') {
                found = m;
                return;
            }
        }
    });
    return found;
}
function standalonePalette() {
    const data = new Uint8Array(SWATCH_COUNT * 4);
    PALETTE_HEX.forEach((hex, i) => {
        data[i * 4] = parseInt(hex.slice(1, 3), 16);
        data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
        data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
        data[i * 4 + 3] = 255;
    });
    const map = new THREE.DataTexture(data, SWATCH_COUNT, 1, THREE.RGBAFormat);
    map.name = 'palette';
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestFilter;
    map.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0, side: THREE.DoubleSide });
}
export function signMaterials(source) {
    const given = source instanceof THREE.Material ? source : findPaletteMaterial(source);
    const wood = given ?? standalonePalette();
    const owned = !given;
    const faces = [];
    return {
        wood,
        owned,
        face(map, options = {}) {
            const material = new THREE.MeshStandardMaterial({
                map, emissiveMap: map, emissive: new THREE.Color(0xffffff),
                emissiveIntensity: options.emissive ?? FACE_EMISSIVE,
                roughness: 0.9, metalness: 0,
                side: THREE.DoubleSide, transparent: options.transparent ?? false,
            });
            faces.push(material);
            return material;
        },
        dispose() {
            for (const face of faces)
                face.dispose();
            faces.length = 0;
            if (owned) {
                wood.map?.dispose();
                wood.dispose();
            }
        },
    };
}
