import vertexShader from "./shaders/vertex.vert"
import fragmentShader from "./shaders/fragment.frag"
import blitShader from "./shaders/blit.frag"
import clipVertexShader from "./shaders/clipVertex.vert";
import clipFragmentShader from "./shaders/clipFragment.frag";
import {Camera} from "./scene";

import {ColorStop, cubeVertices, generateTransferFunction, loadTransferFunction} from "./data";
import {ColorRampComponent} from "./elements/colorramp";
import {HistogramViewer} from "./elements/histogramViewer";
import {Volume} from "./representation/volume";
import {Matrix4, Vector3} from "math.gl";
import {setupPanningListeners} from "./util";
import {UnitCubeDisplay} from "./elements/cubeDirection";
import {volxelStyles, volxelTemplate} from "./template";
import {
  WasmWorkerMessage,
  WasmWorkerMessageFiles,
  WasmWorkerMessageReturn,
  WasmWorkerMessageType,
  WasmWorkerMessageUrls
} from "./common";

import DicomWorker from "./worker?worker&inline"

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
  public static readonly observedAttributes = ["data-urls"]

  private worker = new DicomWorker()
  private workerInitialized = new Promise<void>(resolve => this.worker.addEventListener("message", () => {
    resolve();
  }))

  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | undefined;
  private program: WebGLProgram | undefined;
  private blit: WebGLProgram | undefined;
  private clipping: WebGLProgram | undefined;

  private framebuffers: Framebuffer[] = [];
  private framebufferPingPong: number = 0;
  private frameIndex: number = 0;

  private suspend: boolean = true;
  private resolutionFactor: number = 1;
  private lowResolutionDuration: number = 5;

  private indirection: WebGLTexture | undefined;
  private range: WebGLTexture | undefined;
  private atlas: WebGLTexture | undefined;
  private transfer: WebGLTexture | undefined;

  // inputs
  private densityMultiplier = 1;
  private maxSamples = 1000;
  private debugHits = false;
  private volumeClipMin = new Vector3(0, 0, 0);
  private volumeClipMax = new Vector3(1, 1, 1);

  // input elements
  private histogram: HistogramViewer | undefined;

  private camera: Camera | undefined;
  private sampleRange: [number, number] = [0, 2 ** 16 - 1];

  // light
  private lightDir: Vector3 = new Vector3(-1, -1, -1).normalize();

  // volume settings
  private densityScale: number = 1;
  private volume: Volume | null = null;

  // meshes
  private quad: WebGLVertexArrayObject | undefined
  private clippingCube: WebGLVertexArrayObject | undefined

  public constructor() {
    // static initialization
    if (!initialized) {
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

    try {
      // set up GL context
      const gl = this.canvas.getContext("webgl2");
      if (!gl) throw new Error("WebGL 2 not supported on this Browser");
      this.gl = gl;

      // check for float render target extension
      const floatExtension = gl.getExtension("EXT_color_buffer_float");
      if (!floatExtension) throw new Error("EXT_color_buffer_float extension not available, can't render to float target");

      // check for blending extension
      const blendingExtension = gl.getExtension("EXT_float_blend");
      if (!blendingExtension) throw new Error("EXT_float_blend extension not available, can't render clipping controls")

      // Set up main shaders
      const vertex = createShader(gl, gl.VERTEX_SHADER, vertexShader);
      const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentShader);
      this.program = createProgram(gl, vertex, fragment);

      // Set up blit shaders
      const blit = createShader(gl, gl.FRAGMENT_SHADER, blitShader);
      this.blit = createProgram(gl, vertex, blit);

      // Set up clipping controls shader
      const clipVertex = createShader(gl, gl.VERTEX_SHADER, clipVertexShader);
      const clipFragment = createShader(gl, gl.FRAGMENT_SHADER, clipFragmentShader);
      this.clipping = createProgram(gl, clipVertex, clipFragment);

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

      // Prepare data for drawing step 1: Quad
      // -- Fetch Attribute location from Program
      let positionAttribute = gl.getAttribLocation(this.program, "a_position");
      if (positionAttribute < 0) throw new Error("Failed to find `a_position` attribute in vertex shader");
      // -- Create and prepare Data in Buffer
      let positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1, -1, 1, 1, -1,]), gl.STATIC_DRAW);
      // -- Create and configure Vertex Array Object
      this.quad = gl.createVertexArray();
      gl.bindVertexArray(this.quad);
      gl.enableVertexAttribArray(positionAttribute);
      gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0);
      // Prepare data for drawing step 2: Cube
      // -- Fetch Attribute location from Program
      positionAttribute = gl.getAttribLocation(this.clipping, "a_position");
      if (positionAttribute < 0) throw new Error("Failed to find `a_position` attribute in clipping vertex shader");
      // -- Create and prepare Data in Buffer
      positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, cubeVertices, gl.STATIC_DRAW);
      // -- Create and configure Vertex Array Object
      this.clippingCube = gl.createVertexArray();
      gl.bindVertexArray(this.clippingCube);
      gl.enableVertexAttribArray(positionAttribute);
      gl.vertexAttribPointer(positionAttribute, 3, gl.FLOAT, false, 0, 0);

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
      this.camera = new Camera(1)

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
          this.camera?.rotateAroundView(by);
        })
      }, (by) => {
        return this.restartRendering(() => {
          return this.camera?.zoom(by);
        }) ?? false
      }, (by) => {
        this.restartRendering(() => {
          this.camera?.translateOnPlane(by);
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
        this.restartRendering(() => {
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
        this.restartRendering(() => {
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
        this.restartRendering(() => {
          this.lightDir = new Vector3(x, y, z);
        })
      })
      cubeDirection.direction = this.lightDir;

      const debugHits = this.shadowRoot!.querySelector("#debugHits") as HTMLInputElement;
      debugHits.checked = this.debugHits
      debugHits.addEventListener("change", async () => {
        await this.restartRendering(async () => {
          this.debugHits = debugHits.checked;
        })
      })

      // initial call to the render function
      requestAnimationFrame(this.render)
    } catch (e) {
      console.error(this, "encountered error during startup", e);
      this.handleError(e);
    }
  }

  private handleError(e: unknown) {
    this.classList.add("errored")
    this.shadowRoot!.getElementById("error")!.innerText = e instanceof Error ? e.message : `${e}`;
  }

  public async connectedCallback() {
    await this.restartFromAttributes()
  }
  public async attributesChangedCallback(name: string) {
    if (name === "data-urls") {
      await this.restartFromAttributes()
    }
  }

  private async restartFromAttributes() {
    const urls = this.getAttribute("data-urls")
    if (urls) {
      try {
        const parsed = JSON.parse(urls);
        if (Array.isArray(parsed) && parsed.every(url => typeof url === "string")) {
          await this.restartFromURLs(parsed);
        }
      } catch (e) {
        console.error(this, "encountered error during startup from URLs", e)
        this.classList.add("errored")
        this.shadowRoot!.getElementById("error")!.innerText = e instanceof Error ? e.message : `${e}`;
      }
    }
  }

  private resizeFramebuffersToCanvas() {
    const gl = this.gl;
    if (!gl) throw new Error("Resizing method called without GL context being set up")

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
  private getUniformLocation(name: string, program: WebGLProgram | undefined = this.program) {
    if (!this.gl || !program) return null;
    const loc = this.gl.getUniformLocation(program, name);
    if (!loc && !this.alreadyWarned.has(name)) {
      console.warn("Failed to get uniform location of '" + name + "'");
      this.alreadyWarned.add(name);
    }
    return loc;
  }

  public async restartFromFiles(files: File[] | FileList) {
    await this.workerInitialized;
    await this.restartRendering(async () => {
      await new Promise<void>(resolve => {
        const message: WasmWorkerMessageFiles = {
          type: WasmWorkerMessageType.LOAD_FROM_FILES,
          files
        }
        this.worker.postMessage(message)
        this.setupWorkerListener(resolve)
      })
    })
  }
  public async restartFromURLs(urls: string[]) {
    await this.workerInitialized;
    await this.restartRendering(async () => {
      await new Promise<void>(resolve => {
        const message: WasmWorkerMessageUrls = {
          type: WasmWorkerMessageType.LOAD_FROM_URLS,
          urls
        }
        this.worker.postMessage(message)
        this.setupWorkerListener(resolve)
      })
    })
  }

  private setupWorkerListener(resolve: () => void) {
    const handler = (event: MessageEvent<WasmWorkerMessage>) => {
      switch (event.data.type) {
        case WasmWorkerMessageType.LOAD_FROM_FILES:
        case WasmWorkerMessageType.LOAD_FROM_URLS:
        case WasmWorkerMessageType.LOAD_FROM_BYTES:
          throw new Error(`Invalid message type ${event.data.type} received from worker.`)
        case WasmWorkerMessageType.ERROR: {
          this.worker.removeEventListener("message", handler);
          resolve()
          // TODO: display error somehow
          break;
        }
        case WasmWorkerMessageType.RETURN: {
          this.setupFromGrid(event.data);
          this.worker.removeEventListener("message", handler);
          resolve()
        }
      }
    };
    this.worker.addEventListener("message", handler)
  }

  private setupFromGrid(grid: WasmWorkerMessageReturn) {
    if (!this.gl || !this.indirection || !this.range || !this.atlas) throw new Error("Trying to setup from grid without GL context being initialized")
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
    const ind = grid.indirection
    const range = grid.range
    const atlas = grid.atlas

    // upload indirection buffer
    const [indX, indY, indZ] = grid.indirectionSize;
    this.gl.activeTexture(this.gl.TEXTURE0 + 1)
    this.gl.bindTexture(this.gl.TEXTURE_3D, this.indirection);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage3D(this.gl.TEXTURE_3D, 0, this.gl.RGB10_A2UI, indX, indY, indZ, 0, this.gl.RGBA_INTEGER, this.gl.UNSIGNED_INT_2_10_10_10_REV, ind) // TODO: Check the last parameter again

    // upload range buffer
    const [rangeX, rangeY, rangeZ] = grid.rangeSize
    this.gl.activeTexture(this.gl.TEXTURE0 + 2)
    this.gl.bindTexture(this.gl.TEXTURE_3D, this.range);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage3D(this.gl.TEXTURE_3D, 0, this.gl.RG16F, rangeX, rangeY, rangeZ, 0, this.gl.RG, this.gl.HALF_FLOAT, range)
    // upload range mipmaps
    this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_BASE_LEVEL, 0);
    this.gl.texParameteri(this.gl.TEXTURE_3D, this.gl.TEXTURE_MAX_LEVEL, grid.rangeMipmaps.length);
    let level = 0;
    for (const {mipmap, stride: [x, y, z]} of grid.rangeMipmaps) {
      this.gl.texImage3D(
          this.gl.TEXTURE_3D,
          level + 1,
          this.gl.RG16F,
          x, y, z,
          0,
          this.gl.RG,
          this.gl.HALF_FLOAT,
          mipmap
      )
      level++;
    }

    // upload atlas buffer
    const [atlasX, atlasY, atlasZ] = grid.atlasSize;
    this.gl.activeTexture(this.gl.TEXTURE0 + 3)
    this.gl.bindTexture(this.gl.TEXTURE_3D, this.atlas);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage3D(this.gl.TEXTURE_3D, 0, this.gl.R8, atlasX, atlasY, atlasZ, 0, this.gl.RED, this.gl.UNSIGNED_BYTE, atlas)

    this.histogram?.renderHistogram(grid.histogram, grid.histogramGradient, grid.histogramGradientRange[1])
  }

  private changeTransferFunc(data: Float32Array | null, length: number) {
    if (!this.gl || !this.transfer) throw new Error("Trying to change transfer function without GL context being initialized.")
    this.gl.activeTexture(this.gl.TEXTURE0 + 0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.transfer);
    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 1);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA32F, length, 1, 0, this.gl.RGBA, this.gl.FLOAT, data);
  }

  private restartRendering<T>(action: () => T): T {
    this.classList.add("restarting");
    this.suspend = true;
    const result = action();
    if (result instanceof Promise) {
      // @ts-expect-error ts doesn't understand this
      return result.then(x => {
        this.resolutionFactor = 0.33;
        this.resizeFramebuffersToCanvas();
        this.frameIndex = 0;
        this.suspend = false;
        return x;
      })
    }
    this.resolutionFactor = 0.33;
    this.resizeFramebuffersToCanvas();
    this.frameIndex = 0;
    this.suspend = false;
    return result;
  }

  private render = () => {
    if (!this.gl || !this.program || !this.blit || !this.clipping || !this.camera || !this.quad || !this.clippingCube) throw new Error("Trying to render without GL context initialized.")
    if (this.frameIndex >= this.lowResolutionDuration && this.resolutionFactor !== 1.0) {
      this.resolutionFactor = 1.0;
      this.resizeFramebuffersToCanvas();
    }
    if (!this.suspend && this.frameIndex < this.maxSamples) {
      // bind Quad VAO for raytracing shaders
      this.gl.bindVertexArray(this.quad);

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
      this.camera.bindAsUniforms(this.gl, this.program);
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

      // render clipping controls
      this.gl.enable(this.gl.BLEND);
      this.gl.enable(this.gl.DEPTH_TEST);
      this.gl.enable(this.gl.CULL_FACE)
      this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
      this.gl.blendEquation(this.gl.FUNC_ADD);
      this.gl.bindVertexArray(this.clippingCube);
      this.gl.useProgram(this.clipping);
      this.camera.bindAsUniforms(this.gl, this.clipping);
      if (this.volume) {
        this.gl.uniform3fv(this.getUniformLocation("u_volume_aabb", this.clipping), new Float32Array(this.volume.aabbClipped(this.volumeClipMin, this.volumeClipMin).flat()));
      }
      this.gl.drawArrays(this.gl.TRIANGLES, 0, cubeVertices.length / 3);
      this.gl.disable(this.gl.CULL_FACE);

      // ping pong
      this.framebufferPingPong = (this.framebufferPingPong + 1) % this.framebuffers.length;
      this.frameIndex++;

      this.classList.remove("restarting");
    }

    requestAnimationFrame(this.render);
  }

  private bindUniforms(framebuffer: number) {
    if (!this.gl || !this.transfer || !this.indirection || !this.range || !this.atlas) throw new Error("Trying to bind uniforms to uninitialized GL context.")
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
      this.gl.uniform3fv(this.getUniformLocation("u_volume_aabb"), new Float32Array(this.volume.aabbClipped(this.volumeClipMin, this.volumeClipMax).flat()));
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
    this.gl.uniform1i(this.getUniformLocation("u_debugHits"), this.debugHits ? 1 : 0);

    this.gl.uniform1f(this.getUniformLocation("u_sample_weight"), this.frameIndex < this.lowResolutionDuration ? 0 : (this.frameIndex - this.lowResolutionDuration) / (this.frameIndex - this.lowResolutionDuration + 1));
  }
}

customElements.define("color-ramp-component", ColorRampComponent);
customElements.define("volxel-histogram-viewer", HistogramViewer);
customElements.define("volxel-cube-direction", UnitCubeDisplay);
customElements.define("volxel-3d-viewer", Volxel3DDicomRenderer);