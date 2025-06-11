import * as wasm from "daicom_preprocessor"

export function generateData(width: number, height: number, depth: number, densityFunction: wasm.GeneratedDataType = wasm.GeneratedDataType.Pillars): Uint8Array {
    return wasm.generate_data(width, height, depth, densityFunction);
}

export type DicomData = {
    data: Uint8Array;
    dimensions: [width: number, height: number, depth: number]
}

export const dicomBasePaths: {
    url: `${string}#${string}`,
    from: number,
    to: number,
    replaceLength: number
}[] = [
    {url: "/Volxel/Dicom/Anatomie_24-16/axial/WT/Anatomie^2416^^^=^^^^=^^^^.CT.1.1.#.DCM", from: 1, to: 349, replaceLength: 3},
    {url: "/Volxel/Dicom/53_ER_ANA_AS20180009/0/2/02690#", from: 2, to: 429, replaceLength: 3},
    {url: "/Volxel/Dicom/53_ER_ANA_AS20180009/0/3/02700#", from: 2, to: 510, replaceLength: 3},
    {url: "/Volxel/Dicom/53_ER_ANA_AS20180009/0/4/02710#", from: 2, to: 456, replaceLength: 3},
    {url: "/Volxel/Dicom/53_ER_ANA_AS20180009/0/5/02720#", from: 1, to: 884, replaceLength: 3},
    {url: "/Volxel/Dicom/53_ER_ANA_AS20180009/0/6/0273#", from: 1, to: 1178, replaceLength: 4},
    {url: "/Volxel/Dicom/53_ER_ANA_AS20180009/0/7/02740#", from: 1, to: 148, replaceLength: 3},
    {url: "/Volxel/Dicom/53_ER_ANA_AS20180009/0/8/027500#", from: 1, to: 24, replaceLength: 2},
    {url: "/Volxel/Dicom/53_ER_ANA_AS20180009/0/9/02760#", from: 1, to: 148, replaceLength: 3},
    {url: "/Volxel/Dicom/53_ER_ANA_AS20180009/0/10/02770#", from: 1, to: 152, replaceLength: 3},
    {url: "/Volxel/Dicom/53_ER_ANA_AS20180009/0/11/02780#", from: 1, to: 415, replaceLength: 3},
    {url: "/Volxel/Dicom/53_ER_ANA_AS20180009/0/12/02790#", from: 1, to: 284, replaceLength: 3},
    {url: "/Volxel/Dicom/53_ER_ANA_AS20180009/0/13/02800#", from: 1, to: 415, replaceLength: 3},
    {url: "/Volxel/Dicom/53_ER_ANA_AS20180009/0/501/0282000#", from: 1, to: 2, replaceLength: 1},
]

export async function loadDicomData(index: number = 0): Promise<DicomData> {
    const debug = await wasm.read_dicoms_from_url("/Volxel/Dicom/53_ER_ANA_AS20180009/DICOMDIR", 0, 1, "xxx", 1);
    console.log(debug.width, debug.height, debug.depth);
    // const urls = [dicomBasePath] //new Array(1).fill(0).map((_, i) => dicomBasePath.replace("001", `${i + 1}`.padStart(3, "0")))
    // const allBytes = await Promise.all(urls.map(async (url) => (await fetch(url)).bytes()));
    const { url, from, to, replaceLength } = dicomBasePaths[index];
    const dicomData = await wasm.read_dicoms_from_url(url, from, to, "#", replaceLength)//wasm.read_dicoms(allBytes);
    const dimensions: [number, number, number] = [dicomData.width, dicomData.height, dicomData.depth];
    const readBytes = wasm.read_dicom_bytes(dicomData);

    return {
        data: readBytes,
        dimensions: dimensions
    }
}

export enum TransferFunction {
    None,
    SplineShaded,
    AbdA,
    AbdB,
    AbdC
}

async function loadTransferFromNetwork(path: string): Promise<number[][]> {
    return (await (await fetch(path)).text()).split("\n").map(line => line.split(" ").map(num => Number.parseFloat(num))).filter(line => line.length === 4);
}

export async function loadTransferFunction(transfer: TransferFunction = TransferFunction.None): Promise<{data: Float32Array, length: number}> {
    let result: number[][]
    switch (transfer) {
        case TransferFunction.SplineShaded:
            result = await loadTransferFromNetwork("/Volxel/Dicom/SplineShaded.txt")
            break;
        case TransferFunction.AbdA:
            result = await loadTransferFromNetwork("/Volxel/Dicom/AbdShaded_a.txt")
            break;
        case TransferFunction.AbdB:
            result = await loadTransferFromNetwork("/Volxel/Dicom/AbdShaded_b.txt")
            break;
        case TransferFunction.AbdC:
            result = await loadTransferFromNetwork("/Volxel/Dicom/AbdShaded_c.txt")
            break;
        default:
            result = new Array(128).fill(0).map((_, i) => [1, 1, 1, i / 128]);
            break;
    }
    const length = result.length;
    const data = new Float32Array(result.flat());
    return {data, length}
}

export type ColorStop = {
    color: [r: number, g: number, b: number, density: number],
    stop: number
}

export function generateTransferFunction(colors: ColorStop[], generatedSteps: number = 128): {data: Float32Array, length: number} {
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
                const progressToNext = (currentPosition - sortedColors[currentStop].stop)/(next.stop - sortedColors[currentStop].stop);
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