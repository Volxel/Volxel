import * as wasm from "daicom_preprocessor"

export function generateData(width: number, height: number, depth: number, densityFunction: wasm.GeneratedDataType = wasm.GeneratedDataType.Pillars): Uint8Array {
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
    const urls = new Array(348).fill(0).map((_, i) => "/Volxel/Dicom/Anatomie_24-16/axial/Lunge/Anatomie^2416^^^=^^^^=^^^^.CT.1.2.001.DCM".replace("001", `${i + 1}`.padStart(3, "0")))
    const allBytes = await Promise.all(urls.map(async (url) => (await fetch(url)).bytes()));
    const dicomData = wasm.read_dicoms(allBytes);
    const dimensions: [number, number, number] = [dicomData.width, dicomData.height, dicomData.depth];
    const readBytes = wasm.read_dicom_bytes(dicomData);

    return {
        data: readBytes,
        dimensions: dimensions
    }
}

export async function prepareTransferFunction(gl: WebGL2RenderingContext, texture?: WebGLTexture): Promise<WebGLTexture> {
    if (!texture) {
        texture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + 1);
        gl.bindTexture(gl.TEXTURE_2D,  texture);
        // set the filtering so we don't need mips
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
        gl.activeTexture(gl.TEXTURE0 + 1);
        gl.bindTexture(gl.TEXTURE_2D,  texture);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const length = 1024;
    const data = new Float32Array(new Array(length).fill([1, 1, 1, 0]).map((_, i) => [1, 0, 0, i / length]).flat());
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, length, 1, 0, gl.RGBA, gl.FLOAT, data);
    return texture;
}