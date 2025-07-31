import {Matrix4, Vector3, Vector4} from "math.gl";
import {Grid} from "./grid.ts";
import * as wasm from "daicom_preprocessor";

export class Volume {
    private transform: Matrix4 = new Matrix4().identity();
    constructor(private grid: Grid) {

    }
    static fromWasm(wasm: wasm.BrickGrid) {
        return new Volume(new Grid(wasm))
    }

    combinedTransform(): Matrix4 {
        const gridTransform = this.grid.transform();
        console.log("grid transform", gridTransform)
        return this.transform.clone().multiplyRight(gridTransform);
    }
    toWorld(index: Vector4): Vector4 {
        // @ts-expect-error this should return a 4 element vector always
        return new Vector4().set(...this.combinedTransform().transform(index));
    }
    toIndex(world: Vector4): Vector4 {
        // @ts-expect-error this should return a 4 element vector always
        return new Vector4().set(...this.combinedTransform().invert().transform(world));
    }
    aabb(): [Vector3, Vector3] {
        const wbb_min = this.toWorld(new Vector4(0, 0, 0, 1))
        const indexExtent = this.grid.indexExtent();
        const toTransform = new Vector4().set(indexExtent.x, indexExtent.y, indexExtent.z, 1);
        const wbb_max = this.toWorld(toTransform);
        return [new Vector3(wbb_min.x, wbb_min.y, wbb_min.z), new Vector3(wbb_max.x, wbb_max.y, wbb_max.z)];
    }
    minMaj() {
        return this.grid.minMaj();
    }

    free() {
        this.grid.free();
    }

    setTransform(from: Matrix4) {
        // @ts-expect-error matrix4f is enough to fill a matrix4f
        this.transform.set(...from);
    }
    getTransform(): Matrix4 {
        return this.transform.clone();
    }
}