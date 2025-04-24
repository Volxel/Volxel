import './style.css'

import vertexShader from "./shaders/vertex.vert"
import fragmentShader from "./shaders/fragment.frag"

// Most of this code is straight from https://webgl2fundamentals.org, except the resize observer

function createShader(gl: WebGL2RenderingContext, type: GLenum, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create Shader")
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (success) return shader;
  else {
    const log = gl.getShaderInfoLog(shader);
    console.error("Shader compilation failed\n", log)
    gl.deleteShader(shader);
    throw new Error("Failed to compile shader, check Browser Console for details.");
  }
}

function createProgram(gl: WebGL2RenderingContext, vertex: WebGLShader, fragment: WebGLShader): WebGLProgram {
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

function render(gl: WebGL2RenderingContext, program: WebGLProgram) {
  // Set up viewport size, since canvas size can change
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

  // Clear stuff
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Execute program
  gl.useProgram(program);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function main() {
  // Get canvas to render to
  const canvas = document.getElementById("app") as HTMLCanvasElement;

  // set up GL context
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("WebGL 2 not supported on this Browser");

  // Set up shaders
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShader);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
  const program = createProgram(gl, vertex, fragment);

  // Prepare data for drawing
  // -- Fetch Attribute location from Program
  const positionAttribute = gl.getAttribLocation(program, "a_position");
  if (positionAttribute < 0) throw new Error("Failed to find `a_position` attribute in vertex shader");
  // -- Create and prepare Data in Buffer
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1,  -1, 1,  1, -1,  1, 1,  -1, 1,  1, -1,]), gl.STATIC_DRAW);
  // -- Create and configure Vertex Array Object
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(positionAttribute);
  gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0);
  
  // Prepare automatic resizing of canvas (TODO: This could be better, including taking into account DPI etc.)
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) if (entry.target === canvas) {
      const c: HTMLCanvasElement = entry.target as HTMLCanvasElement;
      c.width = Math.max(
        1,
        entry.contentBoxSize[0].inlineSize
      );
      c.height = Math.max(
        1,
        entry.contentBoxSize[0].blockSize
      );
    }
    render(gl, program);
  });
  resizeObserver.observe(canvas);
}

main();