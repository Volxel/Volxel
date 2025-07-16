import * as wasm from "daicom_preprocessor"

export type DicomData = {
    data: Uint16Array;
    dimensions: [width: number, height: number, depth: number],
    scaling: [x: number, y: number, z: number],
    min_sample: number,
    max_sample: number,
    histogram: Uint32Array,
    gradient: Int32Array
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
    {url: "/Volxel/Dicom/DeutschesMuseum/board/ROI#.dcm", from: 0, to: 523, replaceLength: 3},
    {url: "/Volxel/Dicom/DeutschesMuseum/chiffredevice/2017-402#.dcm", from: 0, to: 783, replaceLength: 3}
]

export function readDicomData(data: Uint8Array[]) {
    const dicomData = wasm.read_dicoms(data);

    const dimensions: [number, number, number] = [dicomData.width, dicomData.height, dicomData.depth];
    const scaling: [number, number, number] = [dicomData.x, dicomData.y, dicomData.z];
    const min = dicomData.min;
    const max = dicomData.max;
    const histogram = wasm.extract_dicom_histogram(dicomData);
    const gradient = wasm.extract_dicom_gradient(dicomData);
    const readBytes = wasm.consume_dicom_to_data(dicomData);

    return {
        data: readBytes,
        dimensions: dimensions,
        scaling: scaling,
        min_sample: min,
        max_sample: max,
        histogram,
        gradient
    }
}

export async function loadDicomData(index: number = 0): Promise<DicomData> {
    const { url, from, to, replaceLength } = dicomBasePaths[index];
    const urls = new Array(to - from).fill(0).map((_, i) => {
        return url.replace("#", `${from + i}`.padStart(replaceLength, "0"))
    })
    const allBytes = await Promise.all(urls.map(async (url) => (await fetch(url)).bytes()));
    return readDicomData(allBytes);
}

export async function loadDicomDataFromFiles(files: FileList | File[]): Promise<DicomData> {
    const data = await Promise.all([...files].map(file => file.bytes()));
    return readDicomData(data);
}

export enum TransferFunction {
    None,
    SplineShaded,
    AbdA,
    AbdB,
    AbdC
}

async function parseTransferFunction(text: string): Promise<number[][]> {
    return text.split("\n").map(line => line.split(" ").map(num => Number.parseFloat(num))).filter(line => line.length === 4)
}

async function loadTransferFromNetwork(path: string): Promise<number[][]> {
    return await parseTransferFunction(await (await fetch(path)).text());
}

export async function loadTransferFunction(transfer: TransferFunction | File = TransferFunction.None): Promise<{data: Float32Array, length: number}> {
    let result: number[][]
    if (transfer instanceof File) {
        result = await parseTransferFunction(await transfer.text());
    } else {
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