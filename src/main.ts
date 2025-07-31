import './style.css'

import vertexShader from "./shaders/vertex.vert"
import fragmentShader from "./shaders/fragment.frag"
import blitShader from "./shaders/blit.frag"
import {Camera, setupPanningListeners} from "./scene.ts";

import * as wasm from "daicom_preprocessor";
import {
  ColorStop,
  dicomBasePaths,
  generateTransferFunction,
  loadGrid,
  loadGridFromFiles,
  loadTransferFunction,
  TransferFunction
} from "./data.ts";
import {ColorRampComponent} from "./colorramp.ts";
import {HistogramViewer} from "./histogramViewer.ts";
import {Volume} from "./representation/volume.ts";
import {Matrix4} from "math.gl";

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
    console.error("Full shader source:\n", source.split("\n").map((it, i) => `${i + 1}: ${it}`).join("\n"));
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

function checkFbo(gl: WebGL2RenderingContext) {
  const fb = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  if (!fb) throw new Error("No framebuffer bound");
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  switch (status) {
    case gl.FRAMEBUFFER_COMPLETE: break;
    case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT: throw new Error("Incomplete attachment");
    case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: throw new Error("Missing attachment");
    case gl.FRAMEBUFFER_UNSUPPORTED: throw new Error("Unsupported combination of formats");
    case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS: throw new Error("Incomplete Dimensions");
    default: throw new Error("Unknown FBO error: 0x" + status.toString(16))
  }
}

type Framebuffer = {
  fbo: WebGLFramebuffer,
  target: WebGLTexture,
}

class State {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private blit: WebGLProgram;

  private framebuffers: Framebuffer[] = [];
  private framebufferPingPong: number = 0;
  private frameIndex: number = 0;

  private suspend: boolean = true;

  private indirection: WebGLTexture;
  private range: WebGLTexture;
  private atlas: WebGLTexture;
  // @ts-ignore happens in util function
  private transfer: WebGLTexture;

  private input = {
    debugHits: false,
    accumulation: true,
    max_samples: 100,
    density_multiplier: 1
  }

  private camera: Camera;
  private sampleRange: [number, number] = [0, 2 ** 16 - 1];

  // volume settings
  private densityScale: number = 1;
  private volume: Volume | null = null;

  // Container that is displaying the data, this will be a web component in the future
  private container: HTMLElement = document.body;

  constructor(defaultTransferFunction: { data: Float32Array, length: number }) {
    // Get canvas to render to
    this.canvas = document.getElementById("app") as HTMLCanvasElement;

    // set up GL context
    const gl = this.canvas.getContext("webgl2");
    if (!gl) throw new Error("WebGL 2 not supported on this Browser");
    this.gl = gl;

    // check for float render target extension
    const floatExtension = gl.getExtension("EXT_color_buffer_float");
    if (!floatExtension) throw new Error("EXT_color_buffer_float extension not available, can't render to float target");

    // Set up main shaders
    const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShader);
    const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
    this.program = createProgram(gl, vertex, fragment);

    // Set up blit shaders
    const blit = createShader(gl, gl.FRAGMENT_SHADER, blitShader);
    this.blit = createProgram(gl, vertex, blit);

    // Prepare framebuffers for ping pong rendering
    for (let i = 0; i < 2; i++) {
      const renderTargetTexture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + 2 + i);
      gl.bindTexture(gl.TEXTURE_2D, renderTargetTexture);
      gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA32F,
          this.canvas.width,
          this.canvas.height,
          0,
          gl.RGBA,
          gl.FLOAT,
          null
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, renderTargetTexture, 0);

      checkFbo(gl);

      this.framebuffers.push({fbo, target: renderTargetTexture});
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

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

    // Setup transfer function
    this.transfer = this.gl.createTexture();
    const { data, length } = defaultTransferFunction;
    this.changeTransferFunc(data, length);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

    // Prepare Lookup Textures
    const setupImage = () => {
      // set the filtering so we don't need mips
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    }
    this.indirection = gl.createTexture();
    this.gl.activeTexture(this.gl.TEXTURE0 + 1);
    this.gl.bindTexture(this.gl.TEXTURE_3D, this.indirection);
    setupImage();
    this.range = gl.createTexture();
    this.gl.activeTexture(this.gl.TEXTURE0 + 2);
    this.gl.bindTexture(this.gl.TEXTURE_3D, this.range);
    setupImage();
    this.atlas = gl.createTexture();
    this.gl.activeTexture(this.gl.TEXTURE0 + 3);
    this.gl.bindTexture(this.gl.TEXTURE_3D, this.atlas);
    setupImage();
    // TODO: Initial data somehow?

    // Setup camera
    this.camera = new Camera(10, this.getUniformLocation("camera_pos"), this.getUniformLocation("camera_view"))

    // Prepare automatic resizing of canvas
    const resizeObserver = new ResizeObserver((entries) => {
      this.restartRendering(() => {
        for (const entry of entries) if (entry.target === this.canvas) {
          const c: HTMLCanvasElement = entry.target as HTMLCanvasElement;
          const ratio = window.devicePixelRatio || 1;
          const width = Math.max(
              1,
              entry.contentBoxSize[0].inlineSize
          ) * ratio;
          const height = Math.max(
              1,
              entry.contentBoxSize[0].blockSize
          ) * ratio;

          c.width = width;
          c.height = height;

          // resize framebuffer textures
          for (const { target } of this.framebuffers) {
            gl.bindTexture(gl.TEXTURE_2D, target);
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA32F,
                width,
                height,
                0,
                gl.RGBA,
                gl.FLOAT,
                null
            )
            gl.bindTexture(gl.TEXTURE_2D, null);
          }
        }
      })
    });
    resizeObserver.observe(this.canvas);

    // Prepare inputs
    setupPanningListeners(this.canvas, (by) => {
      this.restartRendering(() => {
        this.camera.rotateAroundView(by);
      })
    }, (by) => {
      this.restartRendering(() => {
        this.camera.zoom(by);
      })
    }, (by) => {
      this.restartRendering(() => {
        this.camera.translateOnPlane(by);
      })
    });
    const debugHitsCheckbox = document.getElementById("debug_hit") as HTMLInputElement;
    debugHitsCheckbox.checked = this.input.debugHits;
    debugHitsCheckbox.addEventListener("change", () => {
      this.restartRendering(() => {
        this.input.debugHits = debugHitsCheckbox.checked;
      })
    });
    const accumulationCheckbox = document.getElementById("accumulation") as HTMLInputElement;
    accumulationCheckbox.checked = this.input.accumulation;
    accumulationCheckbox.addEventListener("change", () => {
      this.restartRendering(() => {
        this.input.accumulation = accumulationCheckbox.checked;
      })
    });

    const samplesRangeInput = document.getElementById("samples") as HTMLInputElement;
    samplesRangeInput.valueAsNumber = this.input.max_samples;
    samplesRangeInput.addEventListener("change", async () => {
      await this.restartRendering(async () => {
        this.input.max_samples = samplesRangeInput.valueAsNumber;
      })
    })

    const colorRamp = document.getElementById("color-ramp") as ColorRampComponent;
    colorRamp.addEventListener("change", async (event: Event) => {
      await this.restartRendering(() => {
        if (transferSelect.value !== "generated") return;
        const {data, length} = generateTransferFunction((event as CustomEvent<ColorStop[]>).detail);
        this.changeTransferFunc(data, length)
      });
    })

    const transferSelect = document.getElementById("transfer") as HTMLSelectElement;
    transferSelect.value = "none";
    transferSelect.addEventListener("change", async () => {
      await this.restartRendering(async () => {
        let transfer: TransferFunction = {
          spline: TransferFunction.SplineShaded,
          a: TransferFunction.AbdA,
          b: TransferFunction.AbdB,
          c: TransferFunction.AbdC,
        }[transferSelect.value] ?? TransferFunction.None
        const {data, length} = transferSelect.value === "generated" ? generateTransferFunction(colorRamp.colors) : await loadTransferFunction(transfer);
        this.changeTransferFunc(data, length);
      })
    })

    const histogramViewer = document.getElementById("histogram") as HistogramViewer;
    histogramViewer.addEventListener("change", async (event: Event) => {
      await this.restartRendering(async () => {
        this.sampleRange = (event as CustomEvent<[min: number, max: number]>).detail;
      })
    })

    const modelSelect = document.getElementById("density") as HTMLSelectElement;
    for (let i = 0; i < dicomBasePaths.length; i++) {
      const basePath = dicomBasePaths[i];
      const option = document.createElement("option");
      option.value = `dicom_${i}`;
      option.innerHTML = basePath.url;
      modelSelect.appendChild(option);
    }
    modelSelect.value = "";
    modelSelect.addEventListener("change", async () => {
      await this.restartRendering(async () => {
        const grid = await loadGrid(Number.parseInt(modelSelect.value.replace("dicom_", "")))
        this.setupFromGrid(grid);
        histogramViewer.renderHistogram(grid.histogram(), grid.histogram_gradient(), grid.histogram_gradient_max());
      })
    });

    const dicomFileSelect = document.getElementById("dicom") as HTMLInputElement;
    dicomFileSelect.addEventListener("change", async () => {
      await this.restartRendering(async () => {
        const files = dicomFileSelect.files;
        if (!files) {
          alert("no files selected");
          return;
        }

        const grid = await loadGridFromFiles(files);
        this.setupFromGrid(grid);
        histogramViewer.renderHistogram(grid.histogram(), grid.histogram_gradient(), grid.histogram_gradient_max());
      })
    })

    const transferFileSelect = document.getElementById("transfer_file") as HTMLInputElement;
    transferFileSelect.addEventListener("change", async () => {
      await this.restartRendering(async () => {
        const file = transferFileSelect.files;
        if (!file) {
          alert("no files selected");
          return;
        }
        if (file.length != 1) throw new Error("Multiple files selected");
        const {data, length} = await loadTransferFunction(file.item(0)!);
        this.changeTransferFunc(data, length);
      })
    });

    const densityMultiplierInput = document.getElementById("density_multiplier") as HTMLInputElement;
    densityMultiplierInput.valueAsNumber = this.input.density_multiplier;
    densityMultiplierInput.addEventListener("change", async () => {
      await this.restartRendering(async () => {
        this.input.density_multiplier = densityMultiplierInput.valueAsNumber;
      })
    })
  }

  private alreadyWarned: Set<string> = new Set<string>();
  private getUniformLocation(name: string, program: WebGLProgram = this.program) {
    const loc = this.gl.getUniformLocation(program, name);
    if (!loc && !this.alreadyWarned.has(name)) {
      console.warn("Failed to get uniform location of '" + name + "'");
      this.alreadyWarned.add(name);
    }
    return loc;
  }

  private setupFromGrid(grid: wasm.BrickGrid) {
    this.volume?.free();
    this.densityScale = 1.0;

    this.volume = Volume.fromWasm(grid);

    // prepare rescale matrix for AABB of volume (it's not rescaled yet so we can safely call the aabb function)
    const [box_min, box_max] = this.volume.aabb();
    const extent = box_max.subtract(box_min);
    const size = Math.max(extent.x, Math.max(extent.y, extent.z));
    if (size != 1) {
      // TODO: Check order
      this.volume.setTransform(new Matrix4()
          .scale(1 / size)
          .translate(box_min.multiplyByScalar(-1).subtract(extent.multiplyByScalar(0.5)))
        );
      this.densityScale *= size;
    }

    // upload data to respective images
    const ind = grid.indirection_data()
    const range = grid.range_data()
    const atlas = grid.atlas_data()

    // upload indirection buffer
    this.gl.activeTexture(this.gl.TEXTURE0 + 1)
    this.gl.bindTexture(this.gl.TEXTURE_3D, this.indirection);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage3D(this.gl.TEXTURE_3D, 0, this.gl.RGB10_A2UI, grid.ind_x(), grid.ind_y(), grid.ind_z(), 0, this.gl.RGBA_INTEGER, this.gl.UNSIGNED_INT_2_10_10_10_REV, ind) // TODO: Check the last parameter again
    // upload range buffer
    this.gl.activeTexture(this.gl.TEXTURE0 + 2)
    this.gl.bindTexture(this.gl.TEXTURE_3D, this.range);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage3D(this.gl.TEXTURE_3D, 0, this.gl.RG16F, grid.range_x(), grid.range_y(), grid.range_z(), 0, this.gl.RG, this.gl.HALF_FLOAT, range)
    // upload atlas buffer
    this.gl.activeTexture(this.gl.TEXTURE0 + 3)
    this.gl.bindTexture(this.gl.TEXTURE_3D, this.atlas);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage3D(this.gl.TEXTURE_3D, 0, this.gl.R8, grid.atlas_x(), grid.atlas_y(), grid.atlas_z(), 0, this.gl.RED, this.gl.UNSIGNED_BYTE, atlas)
  }

  changeTransferFunc(data: Float32Array, length: number) {
    this.gl.activeTexture(this.gl.TEXTURE0 + 0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.transfer);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA32F, length, 1, 0, this.gl.RGBA, this.gl.FLOAT, data);
  }

  async restartRendering<T>(action: () => T): Promise<Awaited<T>> {
    this.container.classList.add("restarting");
    this.suspend = true;
    const result = await action();
    this.frameIndex = 0;
    this.suspend = false;
    return result;
  }

  render() {
    if (!this.suspend && this.frameIndex < this.input.max_samples) {
      this.gl.disable(this.gl.DEPTH_TEST);
      const previous_pong = (this.framebufferPingPong + this.framebuffers.length - 1) % this.framebuffers.length
      // -- Render into Framebuffer --
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffers[this.framebufferPingPong].fbo);
      this.gl.drawBuffers([this.gl.COLOR_ATTACHMENT0]);
      // Set up viewport size, since canvas size can change
      this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);

      // Clear stuff
      this.gl.clearColor(1, 0, 0, 1);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

      // Execute this.program
      this.gl.useProgram(this.program);
      this.bindUniforms(previous_pong);
      this.camera.bindAsUniforms(this.gl);
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

      // -- Render to canvas --
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);

      // Clear stuff
      this.gl.clearColor(0, 0, 0, 0);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

      this.gl.useProgram(this.blit);
      this.gl.activeTexture(this.gl.TEXTURE0 + 2 + this.framebufferPingPong);
      this.gl.bindTexture(this.gl.TEXTURE_2D, this.framebuffers[this.framebufferPingPong].target);
      this.gl.uniform1i(this.getUniformLocation("u_result", this.blit), 2 + this.framebufferPingPong);
      this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);

      // ping pong
      this.framebufferPingPong = (this.framebufferPingPong + 1) % this.framebuffers.length;
      this.frameIndex++;
      if (!this.input.accumulation) this.suspend = true;
      this.container.classList.remove("restarting");
    }

    requestAnimationFrame(() => this.render());
  }

  bindUniforms(framebuffer: number) {
    this.gl.activeTexture(this.gl.TEXTURE0 + 0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.transfer);
    this.gl.uniform1i(this.getUniformLocation("u_transfer"), 0);
    // brick lookup textures
    this.gl.activeTexture(this.gl.TEXTURE0 + 1);
    this.gl.bindTexture(this.gl.TEXTURE_3D, this.indirection);
    this.gl.uniform1i(this.getUniformLocation("u_density_indirection"), 1);
    this.gl.activeTexture(this.gl.TEXTURE0 + 2);
    this.gl.bindTexture(this.gl.TEXTURE_3D, this.range);
    this.gl.uniform1i(this.getUniformLocation("u_density_range"), 2);
    this.gl.activeTexture(this.gl.TEXTURE0 + 3);
    this.gl.bindTexture(this.gl.TEXTURE_3D, this.atlas);
    this.gl.uniform1i(this.getUniformLocation("u_density_atlas"), 3);

    // bind volume
    if (this.volume) {
      const [min, maj] = this.volume.minMaj();
      const aabb = this.volume.aabb();
      this.gl.uniform3fv(this.getUniformLocation("u_volume_aabb"), new Float32Array(aabb.flat()));
      this.gl.uniform1f(this.getUniformLocation("u_volume_min"), min * this.densityScale);
      this.gl.uniform1f(this.getUniformLocation("u_volume_maj"), maj * this.densityScale);
      this.gl.uniform1f(this.getUniformLocation("u_volume_inv_maj"), 1 / (maj * this.densityScale))

      this.gl.uniform3f(this.getUniformLocation("u_volume_albedo"), 0.9, 0.9, 0.9) // TODO
      this.gl.uniform1f(this.getUniformLocation("u_volume_phase_g"), 0) // TODO
      this.gl.uniform1f(this.getUniformLocation("u_volume_density_scale"), this.densityScale);

      const combinedMatrix = this.volume.combinedTransform()
      this.gl.uniformMatrix4fv(this.getUniformLocation("u_volume_density_transform"), false, combinedMatrix) // TODO
      this.gl.uniformMatrix4fv(this.getUniformLocation("u_volume_density_transform_inv"), false, combinedMatrix.invert())
    }

    // bind density multiplyer
    this.gl.uniform1f(this.getUniformLocation("u_density_multiplier"), this.input.density_multiplier);

    // bind sample range
    this.gl.uniform2f(this.getUniformLocation("u_sample_range"), ...this.sampleRange);

    // reduce stepsize for first few samples to improve performance when looking around
    this.gl.uniform1f(this.getUniformLocation("u_stepsize"), this.frameIndex < 2 ? 0.1 : 0.025);

    // bind previous frame
    this.gl.activeTexture(this.gl.TEXTURE0 + 4 + framebuffer);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.framebuffers[framebuffer].target);
    this.gl.uniform1i(this.getUniformLocation("u_previous_frame"), 4 + framebuffer);

    this.gl.uniform1ui(this.getUniformLocation("u_frame_index"), this.frameIndex);

    this.gl.uniform2i(this.getUniformLocation("u_res"), this.canvas.width, this.canvas.height)
    this.gl.uniform1i(this.getUniformLocation("u_debugHits"), this.input.debugHits ? 1 : 0);

    this.gl.uniform1f(this.getUniformLocation("u_sample_weight"), this.frameIndex < 2 ? 0 : (this.frameIndex - 2) / (this.frameIndex - 1));
  }
}

customElements.define("color-ramp-component", ColorRampComponent);
customElements.define("volxel-histogram-viewer", HistogramViewer);

async function main() {
  wasm.init();
  const state = new State(await loadTransferFunction(TransferFunction.None))
  state.render();
}

main();