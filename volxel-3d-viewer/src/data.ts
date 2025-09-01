async function parseTransferFunction(text: string): Promise<number[][]> {
    return text.split("\n").map(line => line.split(" ").map(num => Number.parseFloat(num))).filter(line => line.length === 4)
}

export async function loadTransferFunction(transfer: File): Promise<{
    data: Float32Array,
    length: number
}> {
    const result: number[][] = await parseTransferFunction(await transfer.text());
    const length = result.length;
    const data = new Float32Array(result.flat());
    return {data, length}
}

export type ColorStop = {
    color: [r: number, g: number, b: number, density: number],
    stop: number
}

export function generateTransferFunction(colors: ColorStop[], generatedSteps: number = 128): {
    data: Float32Array,
    length: number
} {
    if (colors.length < 1) throw new Error("At least one color stop required");
    const sortedColors = [...colors];
    sortedColors.sort((a, b) => a.stop - b.stop);
    if (sortedColors.some(stop => stop.stop < 0.0 || stop.stop > 1.0)) throw new Error("ColorStop outside stop range")

    let currentStop: number = -1;
    const generatedColors: [number, number, number, number][] = [];
    for (let i = 0; i < generatedSteps; ++i) {
        const currentPosition = (i / generatedSteps);
        if (currentStop < 0) {
            if (sortedColors[0].stop >= currentPosition) {
                currentStop = 0;
                generatedColors.push(sortedColors[currentStop].color);
            } else {
                generatedColors.push([0, 0, 0, 0]);
            }
        } else {
            const next = sortedColors[currentStop + 1];
            if (!next) generatedColors.push(sortedColors[currentStop].color);
            else {
                const progressToNext = (currentPosition - sortedColors[currentStop].stop) / (next.stop - sortedColors[currentStop].stop);
                if (progressToNext >= 1.0) {
                    generatedColors.push(next.color);
                    currentStop++;
                    continue;
                }
                const color = sortedColors[currentStop].color.map((v, i) => (1 - progressToNext) * v + progressToNext * next.color[i]) as [number, number, number, number];
                generatedColors.push(color);
            }
        }
    }
    return {
        data: new Float32Array(generatedColors.flat()),
        length: generatedSteps
    }
}

export const cubeVertices = new Float32Array([
    // --- Front (+Z) ---
    -0.5, -0.5,  0.5,
    0.5, -0.5,  0.5,
    0.5,  0.5,  0.5,

    -0.5, -0.5,  0.5,
    0.5,  0.5,  0.5,
    -0.5,  0.5,  0.5,

    // --- Back (-Z) ---
    0.5, -0.5, -0.5,
    -0.5, -0.5, -0.5,
    -0.5,  0.5, -0.5,

    0.5, -0.5, -0.5,
    -0.5,  0.5, -0.5,
    0.5,  0.5, -0.5,

    // --- Left (-X) ---
    -0.5, -0.5, -0.5,
    -0.5, -0.5,  0.5,
    -0.5,  0.5,  0.5,

    -0.5, -0.5, -0.5,
    -0.5,  0.5,  0.5,
    -0.5,  0.5, -0.5,

    // --- Right (+X) ---
    0.5, -0.5,  0.5,
    0.5, -0.5, -0.5,
    0.5,  0.5, -0.5,

    0.5, -0.5,  0.5,
    0.5,  0.5, -0.5,
    0.5,  0.5,  0.5,

    // --- Top (+Y) ---
    -0.5,  0.5,  0.5,
    0.5,  0.5,  0.5,
    0.5,  0.5, -0.5,

    -0.5,  0.5,  0.5,
    0.5,  0.5, -0.5,
    -0.5,  0.5, -0.5,

    // --- Bottom (-Y) ---
    -0.5, -0.5, -0.5,
    0.5, -0.5, -0.5,
    0.5, -0.5,  0.5,

    -0.5, -0.5, -0.5,
    0.5, -0.5,  0.5,
    -0.5, -0.5,  0.5,
].map(it => it * 2));
export const cubeSideIndices = new Int32Array(new Array(cubeVertices.length / 3).fill(0).map((_, i) => Math.floor((i / (cubeVertices.length / 3)) * 6)))
export const cubeBarycentrics = new Float32Array([
    // --- Front (+Z) ---
    1,0,0,  0,1,0,  0,0,1,
    1,0,0,  0,1,0,  0,0,1,

    // --- Back (-Z) ---
    1,0,0,  0,1,0,  0,0,1,
    1,0,0,  0,1,0,  0,0,1,

    // --- Left (-X) ---
    1,0,0,  0,1,0,  0,0,1,
    1,0,0,  0,1,0,  0,0,1,

    // --- Right (+X) ---
    1,0,0,  0,1,0,  0,0,1,
    1,0,0,  0,1,0,  0,0,1,

    // --- Top (+Y) ---
    1,0,0,  0,1,0,  0,0,1,
    1,0,0,  0,1,0,  0,0,1,

    // --- Bottom (-Y) ---
    1,0,0,  0,1,0,  0,0,1,
    1,0,0,  0,1,0,  0,0,1,
])