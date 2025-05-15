import * as wasm from "daicom_preprocessor"

export function generateData(width: number, height: number, depth: number, densityFunction: wasm.GeneratedDataType = wasm.GeneratedDataType.Pillars): Float32Array {
    console.log("invoking wasm");
    const result = wasm.generate_data(width, height, depth, densityFunction);
    console.log("invokation result", result);
    return result;
}

export type DicomData = {
    data: Uint8Array;
    dimensions: [width: number, height: number, depth: number]
}

export async function loadDicomData(): Promise<DicomData> {
    const urls = new Array(500).fill(0).map((_, i) => "/Volxel/Dicom/ROI000.dcm".replace("000", `${i}`.padStart(3, "0")))
    const allBytes = await Promise.all(urls.map(async (url) => (await fetch(url)).bytes()));
    const dicomData = wasm.read_dicoms(allBytes);
    const dimensions: [number, number, number] = [dicomData.width, dicomData.height, dicomData.depth];
    const readBytes = wasm.read_dicom_bytes(dicomData);

    return {
        data: readBytes,
        dimensions: dimensions
    }
}