import {Matrix4, Vector3} from "math.gl";
import {WasmWorkerMessageDicomReturn} from "../common";

export class Grid {
    readonly minMaj: [number, number]
    readonly indexExtent: Vector3
    readonly transform: Matrix4
    constructor(brickGrid: WasmWorkerMessageDicomReturn) {
        this.minMaj = brickGrid.minMaj;
        this.indexExtent = new Vector3(...brickGrid.indexExtent)
        // @ts-expect-error this is a mat4
        this.transform = new Matrix4().set(...brickGrid.transform)
    }
}