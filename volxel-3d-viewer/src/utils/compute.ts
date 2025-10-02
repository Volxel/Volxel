import blitVertex from "../shaders/vertex.vert";
import {createProgram, createShader} from "./gl";

export class ComputeContext {
    private readonly quad: WebGLVertexArrayObject
    private readonly program: WebGLProgram
    private readonly framebuffer: WebGLFramebuffer

    public constructor(private gl: WebGL2RenderingContext, shader: WebGLShader, private input: WebGLTexture, output: WebGLTexture) {
        // prepare blitting program using the given shader as a compute fragment shader
        const vertexShader = createShader(gl, gl.VERTEX_SHADER, blitVertex);
        this.program = createProgram(gl, vertexShader, shader);

        // prepare framebuffer to render into target texture
        this.framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);

        // Prepare data for blit
        // -- Fetch Attribute location from Program
        let positionAttribute = gl.getAttribLocation(this.program, "a_position");
        if (positionAttribute < 0) throw new Error("Failed to find `a_position` attribute in vertex shader for compute context");
        // -- Create and prepare Data in Buffer
        let positionBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
        // -- Create and configure Vertex Array Object
        this.quad = gl.createVertexArray();
        gl.bindVertexArray(this.quad);
        gl.enableVertexAttribArray(positionAttribute);
        gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0);
    }

    private missingUniforms = new Set<string>();
    private uniformLoc = (name: string) => {
        const loc = this.gl.getUniformLocation(this.program, name);
        if (!loc && !this.missingUniforms.has(name)) {
            console.warn("Couldn't find uniform for name " + name);
            this.missingUniforms.add(name);
        }
        return loc;
    }
    public dispatch(width: number, height: number, bindUniforms: (gl: WebGL2RenderingContext, loc: (name: string) => WebGLUniformLocation | null) => number = () => 0, waitForFinish: boolean = true) {
        this.gl.useProgram(this.program);
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffer);
        this.gl.viewport(0, 0, width, height);

        this.gl.bindVertexArray(this.quad);

        this.gl.uniform2i(this.uniformLoc("u_dimension"), width, height);
        const textureOffset = bindUniforms(this.gl, this.uniformLoc);
        this.gl.activeTexture(this.gl.TEXTURE0 + textureOffset);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.input);
        this.gl.uniform1i(this.uniformLoc("u_input"), textureOffset);
        this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.useProgram(null);
        this.gl.bindVertexArray(null);
        if (waitForFinish) this.gl.finish();
    }

    public dispose() {
        this.gl.deleteFramebuffer(this.framebuffer);
        this.gl.deleteProgram(this.program);
        this.gl.deleteVertexArray(this.quad);
    }
}