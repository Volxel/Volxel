import {Matrix4, Vector3} from "math.gl";
import * as wasm from "@volxel/dicom_preprocessor";

export class Grid {
    constructor(private brickGrid: wasm.BrickGrid) {
    }

    minMaj(): [number, number] {
        return [this.brickGrid.minorant(), this.brickGrid.majorant()]
    }
    indexExtent(): Vector3 {
        return new Vector3(this.brickGrid.index_extent_x(), this.brickGrid.index_extent_y(), this.brickGrid.index_extent_z())
    }
    transform(): Matrix4 {
        const fromWasm = this.brickGrid.transform();
        // @ts-expect-error this is a mat4
        return new Matrix4().set(...fromWasm);
    }

    free() {
        this.brickGrid.free()
    }
}