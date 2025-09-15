import {WasmWorkerMessageEnvReturn, WasmWorkerMessageType} from "../common";
import envSetupSource from "../shaders/envSetup.frag";
import {ComputeContext} from "../utils/compute";
import {createShader} from "../utils/gl";

let defaultInstance: Environment | null = null;

// importance map parameters (power of two!)
const DIMENSION = 512;
const SAMPLES = 64;

export class Environment {
    private readonly texture: WebGLTexture;
    private readonly importance: WebGLTexture;

    constructor(private gl: WebGL2RenderingContext, base: WasmWorkerMessageEnvReturn, public strength: number = 1) {
        const floatExt = gl.getExtension("OES_texture_float_linear");
        if (!floatExt) throw new Error(`OES_texture_float_linear not available, cannot prepare environment map.`)
        // Setup base environment map
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 0);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, base.width, base.height, 0, gl.RGBA, gl.FLOAT, base.floats);

        // setup importance map
        this.importance = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.importance);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, DIMENSION, DIMENSION, 0, gl.RED, gl.FLOAT, null);

        const n_samples = Math.floor(Math.sqrt(SAMPLES));

        const importanceComputeContext = new ComputeContext(gl, createShader(gl, gl.FRAGMENT_SHADER, envSetupSource), this.texture, this.importance);
        importanceComputeContext.dispatch(DIMENSION, DIMENSION, (gl, loc) => {
            gl.uniform2i(loc("output_size_samples"), DIMENSION * n_samples, DIMENSION * n_samples);
            gl.uniform2i(loc("num_samples"), n_samples, n_samples);
            gl.uniform1f(loc("inv_samples"), 1.0 / (n_samples * n_samples));

            return 0;
        });
        gl.bindTexture(gl.TEXTURE_2D, this.importance);
        gl.generateMipmap(gl.TEXTURE_2D)
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
        this.gl.activeTexture(this.gl.TEXTURE0 + textureOffset);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.importance);
        this.gl.uniform1i(uniformLoc("u_impmap"), textureOffset++);

        // bind other info
        this.gl.uniform1i(uniformLoc("env_imp_base_mip"), Math.floor(Math.log2(DIMENSION)))
        this.gl.uniform1f(uniformLoc("env_strength"), this.strength)
        this.gl.uniform2f(uniformLoc("env_imp_inv_dim"), 1.0 / DIMENSION, 1.0 / DIMENSION)

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