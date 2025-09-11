
// Most of this code is straight from https://webgl2fundamentals.org, except the resize observer

export function createShader(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("Failed to create Shader")
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (success) return shader;
    else {
        const log = gl.getShaderInfoLog(shader);
        console.error("Shader compilation failed\n", log)
        console.error("Full shader source:\n", source.split("\n").map((it, i) => `${i + 1}: ${it}`).join("\n"));
        gl.deleteShader(shader);
        throw new Error("Failed to compile shader, check Browser Console for details.");
    }
}

export function createProgram(gl: WebGL2RenderingContext, vertex: WebGLShader, fragment: WebGLShader): WebGLProgram {
    const program = gl.createProgram();
    if (!program) throw new Error("Failed to create Program");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);

    const success = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (success) return program;
    else {
        const log = gl.getProgramInfoLog(program);
        console.error("Program linking failed\n", log);
        gl.deleteProgram(program);
        throw new Error("Failed to link program, check Browser Console for details.");
    }
}

export function checkFbo(gl: WebGL2RenderingContext) {
    const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    if (!fb) throw new Error("No framebuffer bound");
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    switch (status) {
        case gl.FRAMEBUFFER_COMPLETE:
            break;
        case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
            throw new Error("Incomplete attachment");
        case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
            throw new Error("Missing attachment");
        case gl.FRAMEBUFFER_UNSUPPORTED:
            throw new Error("Unsupported combination of formats");
        case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
            throw new Error("Incomplete Dimensions");
        default:
            throw new Error("Unknown FBO error: 0x" + status.toString(16))
    }
}

export type Framebuffer = {
    fbo: WebGLFramebuffer,
    target: WebGLTexture,
}