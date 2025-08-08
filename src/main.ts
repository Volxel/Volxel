import "./index.css";

import vertexShader from "./shaders/vertex.vert"
import fragmentShader from "./shaders/fragment.frag"
import blitShader from "./shaders/blit.frag"
import {Camera} from "./scene.ts";

import * as wasm from "daicom_preprocessor";
import {
  ColorStop,
  dicomBasePaths,
  generateTransferFunction,
  loadGrid,
  loadGridFromFiles,
  loadTransferFunction
} from "./data.ts";
import {ColorRampComponent} from "./elements/colorramp.ts";
import {HistogramViewer} from "./elements/histogramViewer.ts";
import {Volume} from "./representation/volume.ts";
import {Matrix4, Vector3} from "math.gl";
import {setupPanningListeners} from "./util.ts";
import {UnitCubeDisplay} from "./elements/cubeDirection.ts";
import {volxelStyles, volxelTemplate} from "./template.ts";

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

let initialized: boolean = false;
let template: HTMLTemplateElement | null = null;

export class Volxel3DDicomRenderer extends HTMLElement {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private blit: WebGLProgram;

  private framebuffers: Framebuffer[] = [];
  private framebufferPingPong: number = 0;
  private frameIndex: number = 0;

  private suspend: boolean = true;
  private resolutionFactor: number = 1;
  private lowResolutionDuration: number = 5;

  private indirection: WebGLTexture;
  private range: WebGLTexture;
  private atlas: WebGLTexture;
  // @ts-ignore happens in util function
  private transfer: WebGLTexture;

  // inputs
  private densityMultiplier = 1;
  private maxSamples = 1000;

  // input elements
  private histogram: HistogramViewer;


  private camera: Camera;
  private sampleRange: [number, number] = [0, 2 ** 16 - 1];

  // light
  private lightDir: Vector3 = new Vector3(-1, -1, -1).normalize();

  // volume settings
  private densityScale: number = 1;
  private volume: Volume | null = null;

  public constructor() {
    // static initialization
    if (!initialized) {
      wasm.init();
      initialized = true;
      template = document.createElement("template");
      template.innerHTML = volxelTemplate;
    }
    super()

    this.attachShadow({mode: "open"});
    this.shadowRoot!.adoptedStyleSheets.push(volxelStyles)

    // setup template
    const instantiated = template!.content.cloneNode(true);
    this.shadowRoot!.appendChild(instantiated);

    // Get canvas to render to
    this.canvas = this.shadowRoot!.getElementById("app") as HTMLCanvasElement;

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
    const { data, length } = generateTransferFunction([{
      color: [1, 1, 1, 0],
      stop: 0
    }, {
      color: [1, 1, 1, 1],
      stop: 1
    }])
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
    this.camera = new Camera(1, this.getUniformLocation("camera_pos"), this.getUniformLocation("camera_view"))

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

    const samplesRangeInput = this.shadowRoot!.getElementById("samples") as HTMLInputElement;
    samplesRangeInput.valueAsNumber = this.maxSamples;
    samplesRangeInput.addEventListener("change", async () => {
      await this.restartRendering(async () => {
        this.maxSamples = samplesRangeInput.valueAsNumber;
      })
    })

    const generatedTransfer = this.shadowRoot!.getElementById("generated_transfer") as HTMLInputElement;
    generatedTransfer.checked = false;
    generatedTransfer.addEventListener("change", async () => {
      await this.restartRendering(() => {
        if (generatedTransfer.checked) {
          const { data, length } = generateTransferFunction(colorRamp.colors);
          this.changeTransferFunc(data, length);
        } else {
          const { data, length } = generateTransferFunction([{
            color: [1, 1, 1, 0],
            stop: 0
          }, {
            color: [1, 1, 1, 1],
            stop: 1
          }])
          this.changeTransferFunc(data, length);
        }
      })
    })

    const transferFileSelect = this.shadowRoot!.getElementById("transfer_file") as HTMLInputElement;
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
        generatedTransfer.checked = false;
      })
    });

    const colorRamp = this.shadowRoot!.getElementById("color-ramp") as ColorRampComponent;
    colorRamp.addEventListener("change", async (event: Event) => {
      await this.restartRendering(() => {
        if (!generatedTransfer.checked) return;
        const {data, length} = generateTransferFunction((event as CustomEvent<ColorStop[]>).detail);
        this.changeTransferFunc(data, length)
      });
    })

    this.histogram = this.shadowRoot!.getElementById("histogram") as HistogramViewer;
    this.histogram.addEventListener("change", async (event: Event) => {
      await this.restartRendering(async () => {
        this.sampleRange = (event as CustomEvent<[min: number, max: number]>).detail;
      })
    })

    const densityMultiplierInput = this.shadowRoot!.getElementById("density_multiplier") as HTMLInputElement;
    densityMultiplierInput.valueAsNumber = this.densityMultiplier;
    densityMultiplierInput.addEventListener("change", async () => {
      await this.restartRendering(async () => {
        this.densityMultiplier = densityMultiplierInput.valueAsNumber;
      })
    })

    const cubeDirection = this.shadowRoot!.querySelector("#direction") as UnitCubeDisplay;
    cubeDirection.addEventListener("direction", async (event) => {
      const { detail: {x, y, z }} = event as CustomEvent<{x: number, y: number, z: number}>;
      await this.restartRendering(() => {
        this.lightDir = new Vector3(x, y, z);
      })
    })
    cubeDirection.direction = this.lightDir;

    // initial call to the render function
    requestAnimationFrame(this.render)
  }

  private resizeFramebuffersToCanvas() {
    const gl = this.gl;

    const scaledWidth = Math.floor(this.canvas.width * this.resolutionFactor)
    const scaledHeight = Math.floor(this.canvas.height * this.resolutionFactor)

    gl.viewport(0, 0, scaledWidth, scaledHeight);
    // resize framebuffer textures
    for (const { target } of this.framebuffers) {
      gl.bindTexture(gl.TEXTURE_2D, target);
      gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA32F,
          scaledWidth,
          scaledHeight,
          0,
          gl.RGBA,
          gl.FLOAT,
          null
      )
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
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

  public setupFromGrid(grid: wasm.BrickGrid) {
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
    // upload range mipmaps
    const mipmaps = grid.range_mipmaps();
    this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_BASE_LEVEL, 0);
    this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_MAX_LEVEL, mipmaps);
    for (let i: number = 0; i < mipmaps; ++i) {
      const x = grid.range_mipmap_stride_x(i), y = grid.range_mipmap_stride_y(i), z = grid.range_mipmap_stride_z(i);
      this.gl.texImage3D(
          this.gl.TEXTURE_3D,
          i + 1,
          this.gl.RG16F,
          x, y, z,
          0,
          this.gl.RG,
          this.gl.HALF_FLOAT,
          grid.range_mipmap(i)
      )
    }

    // upload atlas buffer
    this.gl.activeTexture(this.gl.TEXTURE0 + 3)
    this.gl.bindTexture(this.gl.TEXTURE_3D, this.atlas);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage3D(this.gl.TEXTURE_3D, 0, this.gl.R8, grid.atlas_x(), grid.atlas_y(), grid.atlas_z(), 0, this.gl.RED, this.gl.UNSIGNED_BYTE, atlas)

    this.histogram.renderHistogram(grid.histogram(), grid.histogram_gradient(), grid.histogram_gradient_max())
  }

  changeTransferFunc(data: Float32Array | null, length: number) {
    this.gl.activeTexture(this.gl.TEXTURE0 + 0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.transfer);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA32F, length, 1, 0, this.gl.RGBA, this.gl.FLOAT, data);
  }

  async restartRendering<T>(action: () => T): Promise<Awaited<T>> {
    this.classList.add("restarting");
    this.suspend = true;
    const result = await action();
    this.resolutionFactor = 0.33;
    this.resizeFramebuffersToCanvas();
    this.frameIndex = 0;
    this.suspend = false;
    return result;
  }

  render = () => {
    if (this.frameIndex >= this.lowResolutionDuration && this.resolutionFactor !== 1.0) {
      this.resolutionFactor = 1.0;
      this.resizeFramebuffersToCanvas();
    }
    if (!this.suspend && this.frameIndex < this.maxSamples) {
      this.gl.disable(this.gl.DEPTH_TEST);
      const previous_pong = (this.framebufferPingPong + this.framebuffers.length - 1) % this.framebuffers.length
      // -- Render into Framebuffer --
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffers[this.framebufferPingPong].fbo);
      this.gl.drawBuffers([this.gl.COLOR_ATTACHMENT0]);
      // Set up viewport size, since canvas size can change
      this.gl.viewport(0, 0, this.resolutionFactor * this.gl.canvas.width, this.resolutionFactor * this.gl.canvas.height);

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

      this.classList.remove("restarting");
    }

    requestAnimationFrame(this.render);
  }

  bindUniforms(framebuffer: number) {
    this.gl.activeTexture(this.gl.TEXTURE0 + 0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.transfer);
    this.gl.uniform1i(this.getUniformLocation("u_transfer"), 0);

    // light
    this.gl.uniform3f(this.getUniformLocation("u_light_dir"), this.lightDir.x, this.lightDir.y, this.lightDir.z)

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
      this.gl.uniform1f(this.getUniformLocation("u_volume_min"), min * this.densityScale * this.densityMultiplier);
      this.gl.uniform1f(this.getUniformLocation("u_volume_maj"), maj * this.densityScale * this.densityMultiplier);
      this.gl.uniform1f(this.getUniformLocation("u_volume_inv_maj"), 1 / (maj * this.densityScale * this.densityMultiplier))

      this.gl.uniform3f(this.getUniformLocation("u_volume_albedo"), 0.9, 0.9, 0.9) // TODO
      this.gl.uniform1f(this.getUniformLocation("u_volume_phase_g"), 0) // TODO
      this.gl.uniform1f(this.getUniformLocation("u_volume_density_scale"), this.densityScale * this.densityMultiplier);

      const combinedMatrix = this.volume.combinedTransform()
      this.gl.uniformMatrix4fv(this.getUniformLocation("u_volume_density_transform"), false, combinedMatrix)
      this.gl.uniformMatrix4fv(this.getUniformLocation("u_volume_density_transform_inv"), false, combinedMatrix.invert())
    }

    // bind sample range
    this.gl.uniform2f(this.getUniformLocation("u_sample_range"), ...this.sampleRange);

    // bind previous frame
    this.gl.activeTexture(this.gl.TEXTURE0 + 4 + framebuffer);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.framebuffers[framebuffer].target);
    this.gl.uniform1i(this.getUniformLocation("u_previous_frame"), 4 + framebuffer);

    this.gl.uniform1ui(this.getUniformLocation("u_frame_index"), this.frameIndex);

    this.gl.uniform2i(this.getUniformLocation("u_res"), this.canvas.width, this.canvas.height)
    this.gl.uniform1i(this.getUniformLocation("u_debugHits"), 0);

    this.gl.uniform1f(this.getUniformLocation("u_sample_weight"), this.frameIndex < this.lowResolutionDuration ? 0 : (this.frameIndex - this.lowResolutionDuration) / (this.frameIndex - this.lowResolutionDuration + 1));
  }
}

customElements.define("color-ramp-component", ColorRampComponent);
customElements.define("volxel-histogram-viewer", HistogramViewer);
customElements.define("volxel-cube-direction", UnitCubeDisplay);
customElements.define("volxel-3d-viewer", Volxel3DDicomRenderer);

const renderer = document.getElementById("renderer") as Volxel3DDicomRenderer;

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
  await renderer.restartRendering(async () => {
    const grid = await loadGrid(Number.parseInt(modelSelect.value.replace("dicom_", "")))
    renderer.setupFromGrid(grid);
  })
});

const dicomFileSelect = document.getElementById("dicom") as HTMLInputElement;
dicomFileSelect.addEventListener("change", async () => {
  await renderer.restartRendering(async () => {
    const files = dicomFileSelect.files;
    if (!files) {
      alert("no files selected");
      return;
    }

    const grid = await loadGridFromFiles(files);
    renderer.setupFromGrid(grid);
  })
})