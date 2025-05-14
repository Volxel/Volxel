type DensityFunction = (point: [x: number, y: number, z: number], space: [width: number, height: number, depth: number]) => number;

export const sphereDensity: DensityFunction = ([x, y, z], [width, height, depth]) => {
    return 1 - (Math.pow(x - width / 2, 2) + Math.pow(y - height / 2, 2) + Math.pow(z - depth / 2, 2)) / Math.pow(Math.max(width, height, depth) * 0.9 / 2, 2);
}
export const sinusoidDensity: DensityFunction = ([x, y, z]) => {
    return 1 - (y - 20 - 10 * Math.sin(0.2 * x / (z * 0.05)) * Math.sin(0.1 * z));
}

export const pillarsDensity: DensityFunction = ([x, y, z], [width, height, depth]) => {
    return y < (Math.sin(x / width * 16) * 0.5 + 0.7) * (Math.sin(z / depth * 16) * 0.5 + 0.7) * 0.5 * height ? 1.0 : 0;
}

export function generateData(width: number, height: number, depth: number, densityFunction: DensityFunction = pillarsDensity): Float32Array {
    const data: [number, number, number, number][] = [];
    for (let z = 0; z < depth; z++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        data.push([densityFunction([x, y, z], [width, height, depth]), 0, 0, 1]);
    }
    return new Float32Array(data.flat());
}