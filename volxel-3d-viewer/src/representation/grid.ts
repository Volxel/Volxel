import {Matrix4, Vector3} from "math.gl";
import {WasmWorkerMessageReturn} from "../common";

export class Grid {
    constructor(private brickGrid: WasmWorkerMessageReturn) {
    }

    minMaj(): [number, number] {
        return this.brickGrid.minMaj
    }
    indexExtent(): Vector3 {
        return new Vector3(...this.brickGrid.indexExtent)
    }
    transform(): Matrix4 {
        const fromWasm = this.brickGrid.transform;
        // @ts-expect-error this is a mat4
        return new Matrix4().set(...fromWasm);
    }
}