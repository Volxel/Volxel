import * as wasm from "daicom_preprocessor"

export function generateData(width: number, height: number, depth: number, densityFunction: wasm.GeneratedDataType = wasm.GeneratedDataType.Pillars): Uint8Array {
    return wasm.generate_data(width, height, depth, densityFunction);
}

export type DicomData = {
    data: Uint8Array;
    dimensions: [width: number, height: number, depth: number]
}
const dicomBasePath = "/Volxel/Dicom/Anatomie_24-16/axial/WT/Anatomie^2416^^^=^^^^=^^^^.CT.1.1.001.DCM"

export async function loadDicomData(): Promise<DicomData> {
    const urls = new Array(348).fill(0).map((_, i) => dicomBasePath.replace("001", `${i + 1}`.padStart(3, "0")))
    const allBytes = await Promise.all(urls.map(async (url) => (await fetch(url)).bytes()));
    const dicomData = wasm.read_dicoms(allBytes);
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
