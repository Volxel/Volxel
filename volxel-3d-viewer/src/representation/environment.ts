import {WasmWorkerMessageEnvReturn, WasmWorkerMessageType} from "../common";

let defaultInstance: Environment | null = null;

export class Environment {
    private readonly texture: WebGLTexture;

    constructor(private gl: WebGL2RenderingContext, base: WasmWorkerMessageEnvReturn) {
        // Setup base environment map
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 0);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, base.width, base.height, 0, gl.RGBA, gl.FLOAT, base.floats);
    }

    private readonly notFoundUniforms = new Set<string>()
    public bindUniforms(program: WebGLProgram, textureOffset: number = 0) {
        const uniformLoc = (name: string) => {
            const loc = this.gl.getUniformLocation(program, name);
            if (!loc && !this.notFoundUniforms.has(name)) {
                console.warn(`Uniform with name ${name} not found while binding environment to uniforms`)
                this.notFoundUniforms.add(name);
            }
            return loc;
        }

        // Bind envmap into shader
        this.gl.activeTexture(this.gl.TEXTURE0 + textureOffset);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.texture);
        this.gl.uniform1i(uniformLoc("u_envmap"), textureOffset++);
        // Bind impmap into shader
        // this.gl.activeTexture(this.gl.TEXTURE0 + textureOffset);
        // this.gl.bindTexture(this.gl.TEXTURE_2D, this.importance);
        // this.gl.uniform1i(uniformLoc("u_impmap"), textureOffset++);

        return textureOffset;
    }

    static default(gl: WebGL2RenderingContext) {
        if (defaultInstance) return defaultInstance;// 8x6 checkerboard (row 0 = TOP)
        const width = 8;
        const height = 6;
        const envData = new Float32Array(width * height * 4);

        for (let y = 0; y < height; ++y) {
            const topHalf = y < Math.floor(height / 2); // true for rows 0..2 (top)
            for (let x = 0; x < width; ++x) {
                const isLightSquare = ((x + y) & 1) === 0;
                const val = topHalf
                    ? (isLightSquare ? 3 : 0.9)   // top: 0.9 / 0.7
                    : (isLightSquare ? 0.1 : 0.0);  // bottom: 0.3 / 0.2

                const i = (y * width + x) * 4;
                envData[i + 0] = val; // R
                envData[i + 1] = val; // G
                envData[i + 2] = val; // B
                envData[i + 3] = 1.0; // A
            }
        }
        defaultInstance = new Environment(gl, {
            type: WasmWorkerMessageType.RETURN_ENV,
            width, height, floats: envData
        });
        return defaultInstance;
    }
}