export enum WasmWorkerMessageType {
    LOAD_FROM_URLS = "urls",
    LOAD_FROM_FILES = "files",
    LOAD_FROM_BYTES = "bytes",
    RETURN = "return",
    ERROR = "error",
    INIT = "init"
}

export type WasmWorkerMessageUrls = {
    type: WasmWorkerMessageType.LOAD_FROM_URLS;
    urls: string[];
}

export type WasmWorkerMessageFiles = {
    type: WasmWorkerMessageType.LOAD_FROM_FILES;
    files: File[] | FileList;
}

export type WasmWorkerMessageBytes = {
    type: WasmWorkerMessageType.LOAD_FROM_BYTES;
    bytes: Uint8Array[]
}

export type WasmWorkerMessageReturn = {
    type: WasmWorkerMessageType.RETURN;
    indirectionSize: [x: number, y: number, z: number];
    rangeSize: [x: number, y: number, z: number];
    atlasSize: [x: number, y: number, z: number];
    transform: Float32Array;
    histogram: Uint32Array;
    histogramGradientRange: [min: number, max: number];
    histogramGradient: Int32Array;
    minMaj: [min: number, maj: number];
    indexExtent: [x: number, y: number, z: number];
    rangeMipmaps: {
        mipmap: Uint16Array,
        stride: [x: number, y: number, z: number]
    }[];
    indirection: Uint32Array
    range: Uint16Array,
    atlas: Uint8Array
}

export type WasmWorkerMessageError = {
    type: WasmWorkerMessageType.ERROR;
    error: unknown
}

export type WasmWorkerMessageInit = {
    type: WasmWorkerMessageType.INIT;
}

export type WasmWorkerMessage = WasmWorkerMessageUrls | WasmWorkerMessageFiles | WasmWorkerMessageBytes | WasmWorkerMessageReturn | WasmWorkerMessageError | WasmWorkerMessageInit;