import {WasmWorkerMessage, WasmWorkerMessageError, WasmWorkerMessageReturn, WasmWorkerMessageType} from "./common";
import * as wasm from "@volxel/dicom_preprocessor";

export {}

console.log("before wasm.init()")
wasm.init()
console.log("after wasm.init()")

function buildFromBytesAndReturn(bytes: Uint8Array[]) {
    const grid = wasm.read_dicoms_to_grid(bytes);
    const indirection = grid.indirection_data();
    const atlas = grid.atlas_data();
    const transform = grid.transform();
    const histogram = grid.histogram();
    const histogramGradient = grid.histogram_gradient();
    const rangeMipmaps: WasmWorkerMessageReturn["rangeMipmaps"] = [];

    const mipmaps = grid.range_mipmaps();
    for (let i = 0; i < mipmaps; ++i) {
        const mipmap = grid.range_mipmap(i);
        rangeMipmaps.push({
            mipmap,
            stride: [grid.range_mipmap_stride_x(i), grid.range_mipmap_stride_y(i), grid.range_mipmap_stride_z(i)]
        })
    }

    const range = grid.range_data();

    const returnMessage: WasmWorkerMessageReturn = {
        type: WasmWorkerMessageType.RETURN,
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

self.onmessage = async (ev: MessageEvent<WasmWorkerMessage>) => {
    try {
        const {type} = ev.data;
        switch (type) {
            case WasmWorkerMessageType.RETURN:
            case WasmWorkerMessageType.ERROR:
            case WasmWorkerMessageType.INIT:
                throw new Error(`Worker received ${type} message, this is invalid.`)
            case WasmWorkerMessageType.LOAD_FROM_BYTES: {
                buildFromBytesAndReturn(ev.data.bytes);
                break;
            }
            case WasmWorkerMessageType.LOAD_FROM_FILES: {
                const bytes = await Promise.all([...ev.data.files].map(file => file.bytes()))
                buildFromBytesAndReturn(bytes);
                break;
            }
            case WasmWorkerMessageType.LOAD_FROM_URLS: {
                const bytes = await Promise.all(ev.data.urls.map(url => fetch(url).then(res => res.bytes())))
                buildFromBytesAndReturn(bytes);
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