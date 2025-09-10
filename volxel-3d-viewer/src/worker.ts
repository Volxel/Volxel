import {
    WasmWorkerMessage,
    WasmWorkerMessageDicomReturn,
    WasmWorkerMessageEnvReturn,
    WasmWorkerMessageError,
    WasmWorkerMessageType
} from "./common";
import * as wasm from "@volxel/dicom_preprocessor";

export {}

wasm.init()
function buildFromBytesAndReturn(bytes: Uint8Array[]) {
    const grid = wasm.read_dicoms_to_grid(bytes);
    const indirection = grid.indirection_data();
    const atlas = grid.atlas_data();
    const transform = grid.transform();
    const histogram = grid.histogram();
    const histogramGradient = grid.histogram_gradient();
    const rangeMipmaps: WasmWorkerMessageDicomReturn["rangeMipmaps"] = [];

    const mipmaps = grid.range_mipmaps();
    for (let i = 0; i < mipmaps; ++i) {
        const mipmap = grid.range_mipmap(i);
        rangeMipmaps.push({
            mipmap,
            stride: [grid.range_mipmap_stride_x(i), grid.range_mipmap_stride_y(i), grid.range_mipmap_stride_z(i)]
        })
    }

    const range = grid.range_data();

    const returnMessage: WasmWorkerMessageDicomReturn = {
        type: WasmWorkerMessageType.RETURN_DICOM,
        indirectionSize: [grid.ind_x(), grid.ind_y(), grid.ind_z()],
        indirection,
        atlasSize: [grid.atlas_x(), grid.atlas_y(), grid.atlas_z()],
        atlas,
        transform,
        histogram,
        histogramGradient,
        histogramGradientRange: [grid.histogram_gradient_min(), grid.histogram_gradient_max()],
        minMaj: [grid.minorant(), grid.majorant()],
        indexExtent: [grid.index_extent_x(), grid.index_extent_y(), grid.index_extent_z()],
        rangeMipmaps,
        rangeSize: [grid.range_x(), grid.range_y(), grid.range_z()],
        range
    };
    grid.free()
    self.postMessage(returnMessage, {
        transfer: [indirection.buffer, atlas.buffer, transform.buffer, histogram.buffer, histogramGradient.buffer, ...rangeMipmaps.map(range => range.mipmap.buffer), range.buffer]
    })
}
function buildFromZipBytesAndReturn(zipBytes: Uint8Array) {
    let zipResult: wasm.ZipReadResult;
    try {
        zipResult = wasm.read_zip_to_bytes(zipBytes);
    } catch (e) {
        const error = e as wasm.ZipReadError;
        const type = error.error_type();
        let typeMessage: string;
        switch (type) {
            case wasm.ZipReadErrorType.ExtractFailed: {
                typeMessage = "Extraction failed"
                break;
            }
            case wasm.ZipReadErrorType.NoFiles: {
                typeMessage = "ZIP file empty"
                break;
            }
            case wasm.ZipReadErrorType.MoreThanOneFolder: {
                typeMessage = "More than one folder in ZIP file";
                break;
            }
            default: {
                typeMessage = "Unknown error occurred during ZIP extraction"
            }
        }
        const message = error.message();
        throw new Error(`${typeMessage}${message ? ": " + message : ""}`);
    }
    buildFromBytesAndReturn(zipResult.bytes())
}

function loadEnv(bytes: Uint8Array) {
    const exrImage = wasm.ExrImage.decode_from_bytes(bytes);
    const floats = new Float32Array(exrImage.data())
    const width = exrImage.width, height = exrImage.height;
    exrImage.free();
    const message: WasmWorkerMessageEnvReturn = {
        type: WasmWorkerMessageType.RETURN_ENV,
        floats, width, height
    }
    self.postMessage(message, {
        transfer: [floats.buffer]
    })
}

self.onmessage = async (ev: MessageEvent<WasmWorkerMessage>) => {
    try {
        const {type} = ev.data;
        switch (type) {
            case WasmWorkerMessageType.RETURN_DICOM:
            case WasmWorkerMessageType.ERROR:
            case WasmWorkerMessageType.INIT:
            case WasmWorkerMessageType.RETURN_ENV:
                throw new Error(`Worker received ${type} message, this is invalid.`)
            case WasmWorkerMessageType.LOAD_FROM_BYTES: {
                buildFromBytesAndReturn(ev.data.bytes);
                break;
            }
            case WasmWorkerMessageType.LOAD_FROM_FILES: {
                const bytes = (await Promise.all([...ev.data.files].map(file => file.arrayBuffer()))).map(arrayBuffer => new Uint8Array(arrayBuffer))
                buildFromBytesAndReturn(bytes);
                break;
            }
            case WasmWorkerMessageType.LOAD_FROM_ZIP: {
                const zipBytes = new Uint8Array(await ev.data.zip.arrayBuffer());
                buildFromZipBytesAndReturn(zipBytes)
                break;
            }
            case WasmWorkerMessageType.LOAD_FROM_ZIP_URL: {
                const zipBytes = await (await fetch(ev.data.zipUrl)).bytes()
                buildFromZipBytesAndReturn(zipBytes)
                break;
            }
            case WasmWorkerMessageType.LOAD_FROM_URLS: {
                const bytes = await Promise.all(ev.data.urls.map(url => fetch(url).then(res => res.bytes())))
                buildFromBytesAndReturn(bytes);
                break;
            }
            case WasmWorkerMessageType.LOAD_ENV: {
                loadEnv(ev.data.bytes);
                break;
            }
            default:
                throw new Error(`Unknown message type ${type}`);
        }
    } catch (e) {
        console.error(e);
        self.postMessage({
            type: WasmWorkerMessageType.ERROR,
            error: e
        } as WasmWorkerMessageError)
    }
}

self.postMessage({
    type: WasmWorkerMessageType.INIT
})