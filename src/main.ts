import './style.css'

import vertexShader from "./shaders/vertex.vert"
import fragmentShader from "./shaders/fragment.frag"
import {Camera, setupPanningListeners} from "./scene.ts";

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

type InputState = {
  debugHits: boolean;
}

class State {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;

  private textureLoc: WebGLUniformLocation;
  private volumeAABBLoc: WebGLUniformLocation;
  private resLoc: WebGLUniformLocation;
  private debugHitsLoc: WebGLUniformLocation;

  private input: InputState = {
    debugHits: false
  }

  private camera: Camera;

  constructor() {
    // Get canvas to render to
    this.canvas = document.getElementById("app") as HTMLCanvasElement;

    // set up GL context
    const gl = this.canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL 2 not supported on this Browser");
    this.gl = gl;

    // Set up shaders
    const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShader);
    const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
    this.program = createProgram(gl, vertex, fragment);

    // Prepare data for drawing
    // -- Fetch Attribute location from Program
    const positionAttribute = gl.getAttribLocation(this.program, "a_position");
    if (positionAttribute < 0) throw new Error("Failed to find `a_position` attribute in vertex shader");
    // -- Create and prepare Data in Buffer
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1, -1, 1, 1, -1,]), gl.STATIC_DRAW);
    // -- Create and configure Vertex Array Object
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.enableVertexAttribArray(positionAttribute);
    gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0);

    // Prepare Texture for drawing
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + 0);
    gl.bindTexture(gl.TEXTURE_3D, texture);
    const width = 128, height = 128, depth = 128;
    const data: [number, number, number, number][] = [];
    for (let z = 0; z < depth; z++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      let density = y - 20 - 10 * Math.sin(0.2 * x / (z * 0.05)) * Math.sin(0.1 * z);
      //const density = 1 - (Math.pow(x - width / 2, 2) + Math.pow(y - height / 2, 2) + Math.pow(z - depth / 2, 2)) / Math.pow(Math.min(width, height, depth) / 2, 2);
      data.push([1 - density, 0, 0, 1]);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, width, height, depth, 0, gl.RGBA, gl.FLOAT, new Float32Array(data.flat()))
    // set the filtering so we don't need mips
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    // get uniform locations
    this.textureLoc = this.getUniformLocation("u_texture");
    this.volumeAABBLoc = this.getUniformLocation("u_volume_aabb");
    this.resLoc = this.getUniformLocation("u_res");
    this.debugHitsLoc = this.getUniformLocation("u_debugHits");

    // Setup camera
    this.camera = new Camera(5, this.getUniformLocation("camera_pos"), this.getUniformLocation("camera_view"))

    // Prepare automatic resizing of canvas
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) if (entry.target === this.canvas) {
        const c: HTMLCanvasElement = entry.target as HTMLCanvasElement;
        const ratio = window.devicePixelRatio || 1;
        c.width = Math.max(
          1,
          entry.contentBoxSize[0].inlineSize
        ) * ratio;
        c.height = Math.max(
          1,
          entry.contentBoxSize[0].blockSize
        ) * ratio;
      }
      this.render();
    });
    resizeObserver.observe(this.canvas);

    // Prepare inputs
    setupPanningListeners(this.canvas, (by) => {
      this.camera.rotateAroundView(by);
      this.render();
    }, (by) => {
      this.camera.zoom(by);
      this.render();
    }, (by) => {
      this.camera.translateOnPlane(by);
      this.render();
    });
    const debugHitsCheckbox = document.getElementById("debug_hit") as HTMLInputElement;
    debugHitsCheckbox.checked = this.input.debugHits;
    debugHitsCheckbox.addEventListener("change", () => {
      this.input.debugHits = debugHitsCheckbox.checked;
      this.render();
    })
  }

  private getUniformLocation(name: string): WebGLUniformLocation {
    const loc = this.gl.getUniformLocation(this.program, name);
    if (!loc) throw new Error("Failed to get uniform location of '" + name + "'");
    return loc;
  }

  render() {
    // Set up viewport size, since canvas size can change
    this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);

    // Clear stuff
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    // Execute this.program
    this.gl.useProgram(this.program);
    this.bindUniforms();
    this.camera.bindAsUniforms(this.gl);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
  }

  bindUniforms() {
    this.gl.uniform1i(this.textureLoc, 0);
    this.gl.uniform3fv(this.volumeAABBLoc, new Float32Array([-1, -1, -1, 1, 1, 1]));
    this.gl.uniform2i(this.resLoc, this.canvas.width, this.canvas.height)
    this.gl.uniform1i(this.debugHitsLoc, this.input.debugHits ? 1 : 0);
  }

  private static INSTANCE: State | null = null;

  static instance(): State {
    this.INSTANCE ??= new State();
    return this.INSTANCE;
  }
}

function main() {
  State.instance();
}

main();