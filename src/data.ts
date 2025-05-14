import * as wasm from "daicom_preprocessor"

export function generateData(width: number, height: number, depth: number, densityFunction: wasm.GeneratedDataType = wasm.GeneratedDataType.Pillars): Float32Array {
    console.log("invoking wasm");
    const result = wasm.generate_data(width, height, depth, densityFunction);
    console.log("invokation result", result);
    return result;
}