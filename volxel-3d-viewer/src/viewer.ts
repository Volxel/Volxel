import vertexShader from "./shaders/vertex.vert"
import fragmentShader from "./shaders/fragment.frag"
import blitShader from "./shaders/blit.frag"
import clipVertexShader from "./shaders/clipVertex.vert";
import clipFragmentShader from "./shaders/clipFragment.frag";
import {Camera} from "./representation/scene";

import {
    ColorStop,
    cubeBarycentrics,
    cubeSideIndices,
    cubeVertices,
    generateTransferFunction,
    loadTransferFunction
} from "./utils/data";
import {ColorRampComponent} from "./elements/colorramp";
import {HistogramViewer} from "./elements/histogramViewer";
import {Volume} from "./representation/volume";
import {Matrix4, Vector3} from "math.gl";
import {closestPoints, cubeFace, Ray, rayBoxIntersectionPositions, setupPanningListeners, worldRay} from "./util";
import {UnitCubeDisplay} from "./elements/cubeDirection";
import {volxelStyles, volxelTemplate} from "./template";
import {
    WasmWorkerMessage,
    WasmWorkerMessageDicomReturn,
    WasmWorkerMessageEnvReturn,
    WasmWorkerMessageFiles,
    WasmWorkerMessageType,
    WasmWorkerMessageUrls,
    WasmWorkerMessageZip,
    WasmWorkerMessageZipUrl
} from "./common";
import {
    DisplaySettings,
    LightingSettings,
    loadSettings, saveBenchmark, saveSettings,
    SettingsExport,
    SettingsVersion,
    TransferSettings,
    TransferSettingsTransferType, verifySettings,
    ViewerSettings
} from "./settings";
import {Environment} from "./representation/environment";
import {checkFbo, createProgram, createShader, Framebuffer} from "./utils/gl";
import {Slider} from "./elements/slider";

declare global {
    interface Window {
        createDicomWorker(): Worker
    }
}

let workerFactory: (() => Worker) | undefined = undefined;

export enum VolxelRenderMode {
    DEFAULT = "default",
    NO_DDA = "no_dda",
    RAYMARCH = "raymarch"
}

export type VolxelBenchmarkSettings = {
    zip?: string,
    env?: string,
    renderMode: VolxelRenderMode,
    settings: number | SettingsExport,
}
export type VolxelBenchmark = {
    sharedSettings: SettingsExport[],
    benchmarks: VolxelBenchmarkSettings[]
}
export type VolxelBenchmarkDeviceResult = {
    platform: string,
    userAgent: string,
    deviceMemory: number,
    hardwareConcurrency: number,
    screen: {
        width: number,
        height: number,
        pixelRatio: number
    },
    gpu?: {
        vendor: string,
        renderer: string,
        version: string,
        shadingLanguageVersion: string,
        supportedExtensions: unknown
    }
}
export type VolxelBenchmarkResult = {
    settings: ViewerSettings,
    totalTime: number,
    timePerSample: number,
    viewport: [number, number, number, number],
    device: VolxelBenchmarkDeviceResult,
    timestamp: Date
}

export class Volxel3DDicomRenderer extends HTMLElement {
    public static readonly observedAttributes = ["data-urls", "data-zip-url", "data-settings-url", "data-env-url", "data-render-mode", "data-benchmark-url"]

    private worker = workerFactory!!()
    private workerInitialized = new Promise<void>(resolve => this.worker.addEventListener("message", () => {
        resolve();
    }))

    private canvas: HTMLCanvasElement;
    private gl: WebGL2RenderingContext | undefined;
    private vertexShader: WebGLShader | undefined;
    private program: WebGLProgram | undefined;
    private blit: WebGLProgram | undefined;
    private clipping: WebGLProgram | undefined;

    private framebuffers: Framebuffer[] = [];
    private framebufferPingPong: number = 0;
    private frameIndex: number = 0;

    private suspend: boolean = false;
    private resolutionFactor: number = 1;
    private lowResolutionDuration: number = 5;

    private device: VolxelBenchmarkDeviceResult | undefined;
    private benchmarking: boolean = false;
    private benchmarkTime: number = 0;
    private benchmarkResults: VolxelBenchmarkResult[] = [];
    private benchmarkInits: (() => Promise<void>)[] = [];

    private indirection: WebGLTexture | undefined;
    private range: WebGLTexture | undefined;
    private atlas: WebGLTexture | undefined;
    private transfer: WebGLTexture | undefined;

    // settings, these can be exported and reimported
    private settings: ViewerSettings = {
        densityMultiplier: 1,
        maxSamples: 2000,
        debugHits: false,
        volumeClipMin: new Vector3(0, 0, 0),
        volumeClipMax: new Vector3(1, 1, 1),
        showEnvironment: true,
        useEnv: true,
        lightDir: new Vector3(-1, -1, -1).normalize(),
        syncLightDir: false,
        bounces: 3,
        gamma: 2.2,
        exposure: 5.5,
        sampleRange: [0, 1],
        renderMode: VolxelRenderMode.DEFAULT,
        resolutionFactor: 1
    }

    // used for clipping controls
    private mousePos: [number, number] | null = null;
    private adjustingClipping: boolean = false;
    private showClipping: boolean = true;

    // input elements
    private histogram: HistogramViewer | undefined;

    private camera: Camera | undefined;

    // light
    private lightDirInput: UnitCubeDisplay | undefined;
    // environment
    private environment: Environment | undefined;

    // volume settings
    private densityScale: number = 1;
    private volume: Volume | null = null;

    // meshes
    private quad: WebGLVertexArrayObject | undefined
    private clippingCube: WebGLVertexArrayObject | undefined

    // for export
    private lastRawTransferImport: [r: number, g: number, b: number, density: number][] | undefined;
    private restoreSettings: (settings: SettingsExport) => void = () => undefined

    // error handling
    private errored: boolean = false;

    public constructor() {
        super()

        this.attachShadow({mode: "open"});
        this.shadowRoot!.adoptedStyleSheets.push(volxelStyles)

        // setup template
        const instantiated = volxelTemplate!.content.cloneNode(true);
        this.shadowRoot!.appendChild(instantiated);
        this.classList.add("errored");

        // Get canvas to render to
        this.canvas = this.shadowRoot!.getElementById("app") as HTMLCanvasElement;
        // TODO: somehow touch controls for clipping
        this.canvas.addEventListener("mousemove", (e) => {
            const bound = this.canvas.getBoundingClientRect();
            const relativeX = e.clientX - bound.x;
            const relativeY = e.clientY - bound.y;
            this.mousePos = [relativeX / bound.width * 2 - 1, relativeY / bound.height * (-2) + 1];
        })
        this.canvas.addEventListener("mouseleave", () => this.mousePos = null)

        try {
            // set up GL context
            let gl = this.canvas.getContext("webgl2");
            if (!gl) throw new Error("WebGL 2 not supported on this Browser");

            const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");

            // setup info for benchmarking
            this.device = {
                platform: navigator.platform,
                userAgent: navigator.userAgent,
                deviceMemory: "deviceMemory" in navigator ? navigator.deviceMemory as number : -1,
                hardwareConcurrency: navigator.hardwareConcurrency,
                screen: {
                    width: screen.width,
                    height: screen.height,
                    pixelRatio: window.devicePixelRatio
                },
                gpu: debugInfo ? {
                    vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
                    renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
                    version: gl.getParameter(gl.VERSION),
                    shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
                    supportedExtensions: gl.getSupportedExtensions()
                } : undefined
            }

            const errors = {
                NO_ERROR: gl.NO_ERROR,
                INVALID_ENUM: gl.INVALID_ENUM,
                INVALID_OPERATION: gl.INVALID_OPERATION,
                INVALID_FRAMEBUFFER_OPERATION: gl.INVALID_FRAMEBUFFER_OPERATION,
                OUT_OF_MEMORY: gl.OUT_OF_MEMORY,
                CONTEXT_LOST_WEBGL: gl.CONTEXT_LOST_WEBGL
            }
            gl = new Proxy(gl, {
                get(target: WebGL2RenderingContext, p: keyof WebGL2RenderingContext): any {
                    const prop = target[p]
                    if (typeof prop === "function") return (...args: unknown[]) => {
                        while (target.getError()) {
                            // noop
                        }
                        const ret = (prop as (...args: unknown[]) => unknown).bind(target)(...args);
                        for (let error; (error = target.getError());) {
                            console.error(`Encountered WebGL error during call to ${p}:`, Object.entries(errors).find(([_, id]) => error === id)?.[0] ?? error);
                        }
                        return ret;
                    }
                    return prop;
                }
            })
            this.gl = gl;

            // check for float render target extension
            const floatExtension = gl.getExtension("EXT_color_buffer_float");
            if (!floatExtension) throw new Error("EXT_color_buffer_float extension not available, can't render to float target");

            // check for blending extension
            const blendingExtension = gl.getExtension("EXT_float_blend");
            if (!blendingExtension) {
                console.warn("EXT_float_blend extension not available, can't render clipping controls");
                this.showClipping = false;
            }

            // Set up main shaders
            this.vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShader);
            this.program = this.createShaderProgram(this.vertexShader)

            // Set up blit shaders
            const blit = createShader(gl, gl.FRAGMENT_SHADER, blitShader);
            this.blit = createProgram(gl, this.vertexShader, blit);

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
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 0);

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
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
            // -- Create and configure Vertex Array Object
            this.quad = gl.createVertexArray();
            gl.bindVertexArray(this.quad);
            gl.enableVertexAttribArray(positionAttribute);
            gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 0, 0);

            // Prepare data for drawing step 2: Cube
            // -- Create and configure Vertex Array Object
            this.clippingCube = gl.createVertexArray();
            gl.bindVertexArray(this.clippingCube);
            // -- Create and prepare cube face position Data in Buffer
            positionBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, cubeVertices, gl.STATIC_DRAW);
            // -- Bind position data
            positionAttribute = gl.getAttribLocation(this.clipping, "a_position");
            if (positionAttribute < 0) throw new Error("Failed to find `a_position` attribute in clipping vertex shader");
            gl.enableVertexAttribArray(positionAttribute);
            gl.vertexAttribPointer(positionAttribute, 3, gl.FLOAT, false, 0, 0);
            // -- Create and prepare side index data for cube
            const sideIndexBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, sideIndexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, cubeSideIndices, gl.STATIC_DRAW);
            // -- Bind side index data
            const sideIndexAttribute = gl.getAttribLocation(this.clipping, "a_sideIndex");
            if (sideIndexAttribute < 0) throw new Error("Failed to find `sideIndex` attribute in clipping vertex shader");
            gl.enableVertexAttribArray(sideIndexAttribute);
            gl.vertexAttribIPointer(sideIndexAttribute, 1, gl.INT, 0, 0);
            // -- Create and prepare barycentrics data for cube
            const baryBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, baryBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, cubeBarycentrics, gl.STATIC_DRAW)
            // -- bind barycentrics data
            const barycentricsAttribute = gl.getAttribLocation(this.clipping, "a_barycentrics");
            if (barycentricsAttribute < 0) throw new Error("Failed to find `a_barycentrics` attribute in clipping vertex shader");
            gl.enableVertexAttribArray(barycentricsAttribute);
            gl.vertexAttribPointer(barycentricsAttribute, 3, gl.FLOAT, false, 0, 0);

            // setup default environment map
            this.environment?.dispose();
            this.environment = Environment.default(gl);

            // Setup transfer function
            this.transfer = this.gl.createTexture();
            const {data, length} = generateTransferFunction([{
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
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
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
                }, "Resizing view...")
            });
            resizeObserver.observe(this.canvas);

            // Prepare inputs
            setupPanningListeners(this.canvas, (by, right) => {
                this.restartRendering(() => {
                    if (!right) {
                        this.camera?.rotateAroundView(by);
                        this.maybeSyncLight();
                    } else {
                        this.rescaleAABBFromClippingInput();
                    }
                }, right ? "Rotating camera..." : "Adjusting clipping planes...")
            }, (by) => {
                return this.restartRendering(() => {
                    return this.camera?.zoom(by);
                }, "Zooming...") ?? false
            }, (by) => {
                this.restartRendering(() => {
                    this.camera?.translateOnPlane(by);
                }, "Moving camera...")
            }, (right) => {
                if (right) this.adjustingClipping = true;
            }, (right) => {
                if (right) this.adjustingClipping = false;
            });

            const samplesRangeInput = this.shadowRoot!.getElementById("samples") as Slider;
            samplesRangeInput.value = this.settings.maxSamples;
            samplesRangeInput.addEventListener("change", async () => {
                this.settings.maxSamples = samplesRangeInput.value;
                if (this.settings.maxSamples < this.frameIndex) {
                    this.restartRendering(undefined, "Restarting due to samples change...");
                }
            })

            const generatedTransfer = this.shadowRoot!.getElementById("generated_transfer") as HTMLInputElement;
            generatedTransfer.checked = false;
            generatedTransfer.addEventListener("change", async () => {
                this.restartRendering(() => {
                    if (generatedTransfer.checked) {
                        const {data, length} = generateTransferFunction(colorRamp.colors);
                        this.changeTransferFunc(data, length);
                    } else {
                        const {data, length} = generateTransferFunction([{
                            color: [1, 1, 1, 0],
                            stop: 0
                        }, {
                            color: [1, 1, 1, 1],
                            stop: 1
                        }])
                        this.changeTransferFunc(data, length);
                    }
                }, "Toggling used transfer function...")
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
                    const {data, length, raw} = await loadTransferFunction(file.item(0)!);
                    this.lastRawTransferImport = raw;
                    this.changeTransferFunc(data, length);
                    generatedTransfer.checked = false;
                }, "Loading transfer function from file...")
            });

            const colorRamp = this.shadowRoot!.getElementById("color-ramp") as ColorRampComponent;
            colorRamp.addEventListener("change", async (event: Event) => {
                this.restartRendering(() => {
                    if (!generatedTransfer.checked) return;
                    const {data, length} = generateTransferFunction((event as CustomEvent<ColorStop[]>).detail);
                    this.changeTransferFunc(data, length)
                }, "Adjusting transfer function...");
            })

            this.histogram = this.shadowRoot!.getElementById("histogram") as HistogramViewer;
            this.histogram.addEventListener("change", async (event: Event) => {
                await this.restartRendering(async () => {
                    this.settings.sampleRange = (event as CustomEvent<[min: number, max: number]>).detail;
                }, "Changing displayed density range...")
            })

            const densityMultiplierInput = this.shadowRoot!.getElementById("density_multiplier") as Slider;
            densityMultiplierInput.value = this.settings.densityMultiplier;
            densityMultiplierInput.addEventListener("input", async () => {
                await this.restartRendering(async () => {
                    this.settings.densityMultiplier = densityMultiplierInput.value;
                }, "Adjusting density multiplier...")
            })

            this.lightDirInput = this.shadowRoot!.querySelector("#direction") as UnitCubeDisplay;
            this.lightDirInput.addEventListener("direction", async (event) => {
                const {detail: {x, y, z}} = event as CustomEvent<{ x: number, y: number, z: number }>;
                this.restartRendering(() => {
                    this.settings.lightDir = new Vector3(x, y, z);
                }, "Changing light direction...")
            })
            this.lightDirInput.direction = this.settings.lightDir;

            const backlightToggle = this.shadowRoot!.querySelector("#light_backlight") as HTMLInputElement;
            backlightToggle.checked = this.settings.syncLightDir;
            backlightToggle.addEventListener("change", () => {
                this.restartRendering(() => {
                    this.settings.syncLightDir = backlightToggle.checked;
                    this.maybeSyncLight();
                }, "Toggling backlight...")
            })

            const envStrengthInput = this.shadowRoot!.getElementById("env_strength") as Slider;
            envStrengthInput.value = this.environment!.strength;
            envStrengthInput.addEventListener("input", async () => {
                await this.restartRendering(async () => {
                    this.environment!.strength = envStrengthInput.value;
                }, "Adjusting environment strength...")
            })

            const envUpload = this.shadowRoot!.querySelector("#light_env") as HTMLInputElement;
            envUpload.addEventListener("change", async () => {
                const files = envUpload.files;
                if (files?.length !== 1) return;
                await this.loadEnv(new Uint8Array(await files[0].arrayBuffer()))
                envStrengthInput.value = this.environment!.strength;
            })

            const useEnvCheckbox = this.shadowRoot!.querySelector("#use_env") as HTMLInputElement;
            useEnvCheckbox.checked = this.settings.useEnv
            useEnvCheckbox.addEventListener("change", async () => {
                await this.restartRendering(async () => {
                    this.settings.useEnv = useEnvCheckbox.checked;
                }, "Toggling use of environment...")
            })

            const showEnv = this.shadowRoot!.querySelector("#env_show") as HTMLInputElement;
            showEnv.checked = this.settings.showEnvironment
            showEnv.addEventListener("change", async () => {
                await this.restartRendering(async () => {
                    this.settings.showEnvironment = showEnv.checked;
                }, "Toggling environment visibility...")
            })

            const bouncesInput = this.shadowRoot!.getElementById("bounces") as Slider;
            bouncesInput.value = this.settings.bounces;
            bouncesInput.addEventListener("input", async () => {
                await this.restartRendering(async () => {
                    this.settings.bounces = bouncesInput.value;
                }, "Changing maximum bounces...")
            })

            const gammaInput = this.shadowRoot!.getElementById("gamma") as Slider;
            gammaInput.value = this.settings.gamma;
            gammaInput.addEventListener("input", async () => {
                await this.restartRendering(async () => {
                    this.settings.gamma = gammaInput.value;
                }, "Adjusting gamma...")
            })

            const exposureInput = this.shadowRoot!.getElementById("exposure") as Slider;
            exposureInput.value = this.settings.exposure;
            exposureInput.addEventListener("input", async () => {
                await this.restartRendering(async () => {
                    this.settings.exposure = exposureInput.value;
                }, "Changing exposure...")
            })

            const resolutionInput = this.shadowRoot!.getElementById("resolution") as Slider;
            resolutionInput.value = this.settings.resolutionFactor;
            resolutionInput.addEventListener("input", async () => {
                await this.restartRendering(async () => {
                    this.settings.resolutionFactor = resolutionInput.value;
                }, "Changing resolution factor...")
            })

            const debugHits = this.shadowRoot!.querySelector("#debugHits") as HTMLInputElement;
            debugHits.checked = this.settings.debugHits
            debugHits.addEventListener("change", async () => {
                await this.restartRendering(async () => {
                    this.settings.debugHits = debugHits.checked;
                }, "Toggling debug hits view...")
            })

            // settings export and import
            const exportTransferSettings = (): TransferSettings | null => {
                const useGenerated = generatedTransfer.checked;
                const colors = colorRamp.colors;

                if (!useGenerated && !this.lastRawTransferImport) {
                    alert("No transfer function selected")
                    return null;
                }

                return {
                    densityMultiplier: this.settings.densityMultiplier,
                    transfer: useGenerated ? {
                        type: TransferSettingsTransferType.COLOR_STOPS,
                        colors
                    } : {
                        type: TransferSettingsTransferType.FULL,
                        colors: this.lastRawTransferImport!
                    },
                    histogramRange: this.settings.sampleRange
                }
            }
            const restoreTransferSettings = (settings: TransferSettings) => {
                // restore histogram settings
                this.histogram?.setRange(...settings.histogramRange);
                this.settings.sampleRange = settings.histogramRange;

                // restore density multiplier settings
                this.settings.densityMultiplier = settings.densityMultiplier;
                densityMultiplierInput.value = settings.densityMultiplier;

                // restore color settings
                if (settings.transfer.type === TransferSettingsTransferType.COLOR_STOPS) {
                    colorRamp.colors = settings.transfer.colors;
                    generatedTransfer.checked = true;
                    const {data, length} = generateTransferFunction(colorRamp.colors);
                    this.changeTransferFunc(data, length);
                } else {
                    generatedTransfer.checked = false;
                    const data = new Float32Array(settings.transfer.colors.flat())
                    this.changeTransferFunc(data, settings.transfer.colors.length);
                }
            }
            const exportDisplaySettings = (): DisplaySettings => {
                return {
                    bounces: this.settings.bounces,
                    samples: this.settings.maxSamples,
                    gamma: this.settings.gamma,
                    exposure: this.settings.exposure,
                    debugHits: this.settings.debugHits,
                    renderMode: this.renderMode,
                    resolutionFactor: this.settings.resolutionFactor
                }
            }
            const restoreDisplaySettings = (settings: DisplaySettings) => {
                this.settings.bounces = bouncesInput.value = settings.bounces;
                this.settings.maxSamples = samplesRangeInput.value = settings.samples;
                this.settings.gamma = gammaInput.value = settings.gamma;
                this.settings.exposure = exposureInput.value = settings.exposure;
                this.settings.debugHits = debugHits.checked = settings.debugHits;
                this.settings.resolutionFactor = settings.resolutionFactor;
                this.renderMode = settings.renderMode
            }
            const exportLightingSettings = (): LightingSettings => {
                return {
                    useEnv: this.settings.useEnv,
                    showEnv: this.settings.showEnvironment,
                    envStrength: this.environment!.strength,
                    syncLightDir: this.settings.syncLightDir,
                    lightDir: [this.settings.lightDir.x, this.settings.lightDir.y, this.settings.lightDir.z]
                }
            }
            const restoreLightingSettings = (settings: LightingSettings) => {
                this.lightDirInput!.direction = this.settings.lightDir = new Vector3(...settings.lightDir);
                this.settings.showEnvironment = showEnv.checked = settings.showEnv;
                this.settings.useEnv = useEnvCheckbox.checked = settings.useEnv;
                this.environment!.strength = envStrengthInput.value = settings.envStrength;
                this.settings.syncLightDir = backlightToggle.checked = settings.syncLightDir;
            }
            this.restoreSettings = (settings) => {
                restoreTransferSettings(settings.transfer);
                restoreDisplaySettings(settings.display);
                restoreLightingSettings(settings.lighting);
                const {clipMax, clipMin, cameraLookAt, cameraPos} = settings.other;
                this.settings.volumeClipMax = new Vector3(...clipMax);
                this.settings.volumeClipMin = new Vector3(...clipMin);
                this.camera!.pos = new Vector3(...cameraPos);
                this.camera!.view = new Vector3(...cameraLookAt);
            }
            const exportSettings = (): SettingsExport | null => {
                const transfer = exportTransferSettings();
                if (!transfer) return null
                return {
                    version: SettingsVersion.V3,
                    transfer,
                    lighting: exportLightingSettings(),
                    display: exportDisplaySettings(),
                    other: {
                        clipMax: [this.settings.volumeClipMax.x, this.settings.volumeClipMax.y, this.settings.volumeClipMax.z],
                        clipMin: [this.settings.volumeClipMin.x, this.settings.volumeClipMin.y, this.settings.volumeClipMin.z],
                        cameraLookAt: [this.camera!.view.x, this.camera!.view.y, this.camera!.view.z],
                        cameraPos: [this.camera!.pos.x, this.camera!.pos.y, this.camera!.pos.z]
                    }
                }
            }

            const exportButton = this.shadowRoot!.getElementById("exportSettings") as HTMLButtonElement;
            exportButton.addEventListener("click", () => {
                const settings = exportSettings();
                if (!settings) return;
                verifySettings(settings);
                saveSettings(settings);
            });

            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.accept = "application/json"
            fileInput.addEventListener("change", async () => {
                const file = fileInput.files;
                if (!file || file.length !== 1) {
                    alert("Please select only one settings file");
                    return;
                }
                const settings = await loadSettings(file.item(0)!);
                this.restartRendering(() => this.restoreSettings(settings), "Loading Settings...");
            });
            const importButton = this.shadowRoot!.getElementById("importSettings") as HTMLButtonElement;
            importButton.addEventListener("click", () => fileInput.click())

            const renderModeSelect = this.shadowRoot!.getElementById("render-mode") as HTMLSelectElement;
            renderModeSelect.value = this.renderMode;
            renderModeSelect.addEventListener("change", async () => {
                this.renderMode = renderModeSelect.value as VolxelRenderMode;
                await this.restartRenderMode();
            })

            const benchmarkButton = this.shadowRoot!.getElementById("benchmark") as HTMLButtonElement;
            benchmarkButton.addEventListener("click", () => { this.singleBenchmark(); })

            // initial call to the render function
            requestAnimationFrame(this.render)
        } catch (e) {
            this.handleError(e);
        }
    }

    private createShaderProgram(vertex: WebGLShader): WebGLProgram {
        if (!this.gl) throw new Error("WebGL context undefined for creating shader program");
        let defines = "";
        switch (this.renderMode) {
            case VolxelRenderMode.NO_DDA:
                defines = "#define NO_DDA";
                break;
            case VolxelRenderMode.RAYMARCH:
                defines = "#define RAYMARCH";
                break;
            case VolxelRenderMode.DEFAULT:
            default:
                break;
        }
        const fragment = createShader(this.gl, this.gl.FRAGMENT_SHADER, fragmentShader.replace("// DEFINES", defines));
        return createProgram(this.gl, vertex, fragment);
    }

    private maybeSyncLight() {
        if (this.settings.syncLightDir) {
            const diff = this.camera!.view.clone().subtract(this.camera!.pos);
            this.settings.lightDir.set(-diff.x, -diff.y, -diff.z);
            this.lightDirInput!.direction = this.settings.lightDir;
        }
    }

    private handleError = (e: unknown) => {
        this.errored = true;
        console.error("error encountered", e);
        let message: string;
        if (e instanceof Error) {
            message = `${e.name}: ${e.message}`
        } else if (e instanceof Response) {
            message = `${e.status}: ${e.statusText}`
        } else if (e instanceof XMLHttpRequest) {
            message = `${e.status}: ${e.statusText}`
        } else if (typeof e === "string") {
            message = e;
        } else {
            message = JSON.stringify(e);
        }
        this.classList.add("errored")
        this.suspend = true;
        this.classList.remove("restarting")
        this.shadowRoot!.getElementById("error")!.innerText = message;
    }

    private clearError() {
        this.classList.remove("errored");
        this.shadowRoot!.getElementById("error")!.innerText = "";
    }

    public async connectedCallback() {
        await this.restartFromAttributes()
        await this.attributeBenchmark()
    }

    public async attributesChangedCallback(name: string) {
        if (name === "data-render-mode") {
            await this.restartRenderMode();
        }
        if (name === "data-urls" || name === "data-zip-url" || name === "data-settings-url" || name === "data-env-url") {
            await this.restartFromAttributes()
        }
        if (name === "data-benchmark-url") {
            await this.attributeBenchmark()
        }
    }

    private async attributeBenchmark() {
        const url = this.getAttribute("data-benchmark-url");
        if (!url) return;
        const benchmarkResp = await fetch(url);
        const text = await benchmarkResp.text();
        if (!benchmarkResp.ok) throw new Error(`Failed to fetch benchmark URL: ${benchmarkResp.status} (${benchmarkResp.statusText})\n${text}`)
        const benchmark = JSON.parse(text);
        await this.startBenchmark(benchmark);
    }

    private async restartRenderMode() {
        await this.restartRendering(async () => {
            if (!this.vertexShader) throw new Error("No vertex shader defined for program creation")
            this.program = this.createShaderProgram(this.vertexShader)
        }, "Setting Render Mode")
    }

    private singleBenchmark() {
        this.restartRendering(() => {
            this.benchmarking = true;
            this.benchmarkTime = 0;
        }, "Starting benchmark")
    }

    public async startBenchmark(benchmarkCollection: VolxelBenchmark) {
        this.benchmarkResults.splice(0)
        this.benchmarkInits.splice(0);
        for (const benchmark of benchmarkCollection.benchmarks) {
            this.benchmarkInits.push(async () => {
                await this.restartRendering(async () => {
                    if (benchmark.zip) await this.restartFromZipUrl(benchmark.zip)
                    if (benchmark.env) await this.loadEnvFromUrl(benchmark.env)
                    if (typeof benchmark.settings === "number") {
                        this.restoreSettings(benchmarkCollection.sharedSettings[benchmark.settings])
                    } else {
                        this.restoreSettings(benchmark.settings)
                    }
                    if (benchmark.renderMode) {
                        this.renderMode = benchmark.renderMode
                        await this.restartRenderMode()
                    }
                    this.singleBenchmark();
                }, "Setting up benchmark")
            })
        }
        this.benchmarkInits.reverse()
        const firstBenchmark = this.benchmarkInits.pop();
        if (firstBenchmark) await firstBenchmark();
    }

    private async restartFromAttributes() {
        const urls = this.getAttribute("data-urls")
        const zipUrl = this.getAttribute("data-zip-url")
        const settingsUrl = this.getAttribute("data-settings-url")
        const envUrl = this.getAttribute("data-env-url")
        try {
            await this.restartRendering(async () => {
                if (zipUrl) {
                    await this.restartFromZipUrl(zipUrl);
                } else if (urls) {
                    const parsed = JSON.parse(urls);
                    if (Array.isArray(parsed) && parsed.every(url => typeof url === "string")) {
                        await this.restartFromURLs(parsed);
                    }
                }
                if (settingsUrl) {
                    const response = await fetch(settingsUrl);
                    if (!response.ok) {
                        throw new Error(`Settings URL fetch failed: ${response.status} (${response.statusText})`);
                    }
                    const text = await response.text();
                    const settings = await loadSettings(text);
                    this.restoreSettings(settings);
                }
                if (envUrl) {
                    await this.loadEnvFromUrl(envUrl);
                }
            }, "Loading from Attributes...")
        } catch (e) {
            this.handleError(e);
        }
    }

    private resizeFramebuffersToCanvas() {
        const gl = this.gl;
        if (!gl) throw new Error("Resizing method called without GL context being set up")

        const scaledWidth = Math.floor(this.canvas.width * this.resolutionFactor * this.settings.resolutionFactor)
        const scaledHeight = Math.floor(this.canvas.height * this.resolutionFactor * this.settings.resolutionFactor)

        gl.viewport(0, 0, scaledWidth, scaledHeight);
        // resize framebuffer textures
        for (const {target} of this.framebuffers) {
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
            await new Promise<void>((resolve, reject) => {
                const message: WasmWorkerMessageFiles = {
                    type: WasmWorkerMessageType.LOAD_FROM_FILES,
                    files
                }
                this.worker.postMessage(message)
                this.setupWorkerListener(resolve, reject)
            })
        }, "Loading DICOM data from multiple files")
    }

    public async restartFromZip(zip: File) {
        await this.workerInitialized;
        await this.restartRendering(async () => {
            await new Promise<void>((resolve, reject) => {
                const message: WasmWorkerMessageZip = {
                    type: WasmWorkerMessageType.LOAD_FROM_ZIP,
                    zip
                }
                this.worker.postMessage(message)
                this.setupWorkerListener(resolve, reject)
            })
        }, "Loading DICOM data from ZIP...")
    }

    public async restartFromZipUrl(url: string) {
        await this.workerInitialized;
        await this.restartRendering(async () => {
            await new Promise<void>((resolve, reject) => {
                const message: WasmWorkerMessageZipUrl = {
                    type: WasmWorkerMessageType.LOAD_FROM_ZIP_URL,
                    zipUrl: url
                }
                this.worker.postMessage(message)
                this.setupWorkerListener(resolve, reject)
            })
        }, "Loading DICOM data from ZIP via URL...")
    }

    public async restartFromURLs(urls: string[]) {
        await this.workerInitialized;
        await this.restartRendering(async () => {
            await new Promise<void>((resolve, reject) => {
                const message: WasmWorkerMessageUrls = {
                    type: WasmWorkerMessageType.LOAD_FROM_URLS,
                    urls
                }
                this.worker.postMessage(message)
                this.setupWorkerListener(resolve, reject)
            })
        }, "Loading DICOM data from multiple URLs...")
    }

    public async loadEnv(bytes: Uint8Array) {
        await this.workerInitialized;
        await this.restartRendering(async () => {
            await new Promise<void>((resolve, reject) => {
                const message: WasmWorkerMessage = {
                    type: WasmWorkerMessageType.LOAD_ENV,
                    bytes
                }
                this.worker.postMessage(message, {
                    transfer: [bytes.buffer]
                })
                this.setupWorkerListener(resolve, reject)
            })
        }, "Loading environment map...")
    }

    public async loadEnvFromUrl(url: string) {
        const response = await fetch(url)
        if (!response.ok) throw new Error("Environment fetch responded with error response");
        const bytes = await response.arrayBuffer();
        await this.workerInitialized;
        await this.loadEnv(new Uint8Array(bytes));
    }

    private setupWorkerListener(resolve: () => void, reject: (e: unknown) => void) {
        const handler = (event: MessageEvent<WasmWorkerMessage>) => {
            this.worker.removeEventListener("message", handler);
            switch (event.data.type) {
                case WasmWorkerMessageType.LOAD_FROM_FILES:
                case WasmWorkerMessageType.LOAD_FROM_URLS:
                case WasmWorkerMessageType.LOAD_FROM_BYTES:
                case WasmWorkerMessageType.LOAD_ENV:
                    reject(new Error(`Invalid message type ${event.data.type} received from worker.`))
                    break;
                case WasmWorkerMessageType.ERROR: {
                    reject(event.data.error);
                    break;
                }
                case WasmWorkerMessageType.RETURN_DICOM: {
                    this.setupFromGrid(event.data);
                    resolve()
                    break;
                }
                case WasmWorkerMessageType.RETURN_ENV: {
                    this.setupEnv(event.data);
                    resolve();
                    break;
                }
                default: {
                    reject("Reached default case in Wasm Worker Message Handler")
                }
            }
        };
        this.worker.addEventListener("message", handler)
    }

    private setupEnv(env: WasmWorkerMessageEnvReturn) {
        if (!this.gl) throw new Error("Tried to load env into uninitialized gl context");
        this.environment?.dispose();
        this.environment = new Environment(this.gl, env);
    }

    private setupFromGrid(grid: WasmWorkerMessageDicomReturn) {
        if (!this.gl || !this.indirection || !this.range || !this.atlas) throw new Error("Trying to setup from grid without GL context being initialized")
        this.densityScale = 1.0;
        this.settings.volumeClipMax = new Vector3(1, 1, 1);
        this.settings.volumeClipMin = new Vector3(0, 0, 0);

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

    private restartRendering<T>(action?: () => T, message: string = "Loading and preparing..."): T | undefined {
        if (this.errored) return;
        this.classList.add("restarting");
        this.clearError();
        this.shadowRoot!.getElementById("loadingIndicator")!.innerText = message;
        // JS runs on a single main thread, there shouldn't ever by multithreading issues here
        const previousSuspend = this.suspend;
        this.suspend = true;
        const result = action && action();
        if (result instanceof Promise) {
            // @ts-expect-error ts doesn't understand this
            return result.then(x => {
                this.resolutionFactor = 0.33;
                this.resizeFramebuffersToCanvas();
                this.frameIndex = 0;
                this.suspend = previousSuspend;
                return x;
            }).catch(e => {
                this.handleError(e);
            })
        }
        this.resolutionFactor = 0.33;
        this.resizeFramebuffersToCanvas();
        this.frameIndex = 0;
        this.suspend = previousSuspend;
        return result;
    }

    private render = () => {
        if (!this.gl || !this.program || !this.blit || !this.clipping || !this.camera || !this.quad || !this.clippingCube) throw new Error("Trying to render without GL context initialized.")
        if (this.frameIndex >= this.lowResolutionDuration && this.resolutionFactor !== 1.0) {
            this.resolutionFactor = 1.0;
            this.resizeFramebuffersToCanvas();
        }
        if (!this.suspend) {
            const frameStart = performance.now();
            let current_pong = this.framebufferPingPong;
            // bind Quad VAO for raytracing shaders
            this.gl.bindVertexArray(this.quad);
            if (this.frameIndex <= this.settings.maxSamples) {
                this.gl.disable(this.gl.DEPTH_TEST);
                const previous_pong = (this.framebufferPingPong + this.framebuffers.length - 1) % this.framebuffers.length
                // -- Render into Framebuffer --
                this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffers[this.framebufferPingPong].fbo);
                this.gl.drawBuffers([this.gl.COLOR_ATTACHMENT0]);
                // Set up viewport size, since canvas size can change
                this.gl.viewport(0, 0, this.settings.resolutionFactor * this.resolutionFactor * this.gl.canvas.width, this.settings.resolutionFactor * this.resolutionFactor * this.gl.canvas.height);

                // Clear stuff
                this.gl.clearColor(1, 0, 0, 1);
                this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

                // Execute this.program
                this.gl.useProgram(this.program);
                this.bindUniforms(previous_pong);
                this.camera.bindAsUniforms(this.gl, this.program);
                this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

                if (this.benchmarking) {
                    this.gl.finish();

                    const frameEnd = performance.now();
                    this.benchmarkTime += (frameEnd - frameStart);
                }

                // -- Render to canvas --
                this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

                // ping pong
                current_pong = this.framebufferPingPong;
                this.framebufferPingPong = (this.framebufferPingPong + 1) % this.framebuffers.length;
                this.frameIndex++;

                if (this.frameIndex % 100 === 0 && this.benchmarking) {
                    console.log("Rendered frame", this.frameIndex, "of", this.settings.maxSamples)
                }

                this.classList.remove("restarting");
            } else if (this.benchmarking) {
                const result: VolxelBenchmarkResult = {
                    settings: this.settings,
                    timePerSample: this.benchmarkTime / this.frameIndex,
                    totalTime: this.benchmarkTime,
                    viewport: this.gl.getParameter(this.gl.VIEWPORT),
                    device: this.device!,
                    timestamp: new Date()
                }
                this.benchmarkResults.push(JSON.parse(JSON.stringify(result)));
                console.log("benchmark result", JSON.stringify(result, null, 2))
                this.benchmarking = false;
                this.benchmarkTime = 0;
                const nextBenchmarkInit = this.benchmarkInits.pop()
                if (nextBenchmarkInit) nextBenchmarkInit().then()
                else {
                    saveBenchmark(this.benchmarkResults)
                }
            }
            this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);

            // Clear stuff
            this.gl.clearColor(0, 0, 1, 1);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

            this.gl.useProgram(this.blit);
            this.gl.activeTexture(this.gl.TEXTURE0 + 2 + current_pong);
            this.gl.bindTexture(this.gl.TEXTURE_2D, this.framebuffers[current_pong].target);
            this.gl.uniform1f(this.getUniformLocation("gamma", this.blit), this.settings.gamma);
            this.gl.uniform1f(this.getUniformLocation("exposure", this.blit), this.settings.exposure);
            this.gl.uniform1i(this.getUniformLocation("u_result", this.blit), 2 + current_pong);
            this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);

            if (this.showClipping) {// render clipping controls
                this.gl.enable(this.gl.BLEND);
                this.gl.enable(this.gl.DEPTH_TEST);
                this.gl.enable(this.gl.CULL_FACE)
                this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
                this.gl.blendEquation(this.gl.FUNC_ADD);
                this.gl.bindVertexArray(this.clippingCube);
                this.gl.useProgram(this.clipping);
                this.camera.bindAsUniforms(this.gl, this.clipping);
                if (this.volume) {
                    const aabb = this.volume.aabbClipped(this.settings.volumeClipMin, this.settings.volumeClipMax);
                    const face = this.currentCubeFace(aabb);
                    this.gl.uniform3fv(this.getUniformLocation("u_volume_aabb", this.clipping), new Float32Array(aabb.flat()));
                    this.gl.uniform1i(this.getUniformLocation("u_selected_face", this.clipping), (typeof face === "number" ? face + 1 : 0) * (this.adjustingClipping ? -1 : 1))
                }
                this.gl.drawArrays(this.gl.TRIANGLES, 0, cubeVertices.length / 3);
                this.gl.disable(this.gl.CULL_FACE);
                this.gl.disable(this.gl.DEPTH_TEST);
                this.gl.disable(this.gl.BLEND);
                this.gl.bindVertexArray(null);
                this.gl.useProgram(null);
            }
            this.gl.finish()
        }

        requestAnimationFrame(this.render);
    }

    private bindUniforms(framebuffer: number) {
        if (!this.gl || !this.transfer || !this.indirection || !this.range || !this.atlas || !this.program) throw new Error("Trying to bind uniforms to uninitialized GL context.")
        let textureOffset = 0;
        this.gl.activeTexture(this.gl.TEXTURE0 + textureOffset);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.transfer);
        this.gl.uniform1i(this.getUniformLocation("u_transfer"), textureOffset++);

        // light
        this.gl.uniform3f(this.getUniformLocation("u_light_dir"), this.settings.lightDir.x, this.settings.lightDir.y, this.settings.lightDir.z)

        // brick lookup textures
        this.gl.activeTexture(this.gl.TEXTURE0 + textureOffset);
        this.gl.bindTexture(this.gl.TEXTURE_3D, this.indirection);
        this.gl.uniform1i(this.getUniformLocation("u_density_indirection"), textureOffset++);
        this.gl.activeTexture(this.gl.TEXTURE0 + textureOffset);
        this.gl.bindTexture(this.gl.TEXTURE_3D, this.range);
        this.gl.uniform1i(this.getUniformLocation("u_density_range"), textureOffset++);
        this.gl.activeTexture(this.gl.TEXTURE0 + textureOffset);
        this.gl.bindTexture(this.gl.TEXTURE_3D, this.atlas);
        this.gl.uniform1i(this.getUniformLocation("u_density_atlas"), textureOffset++);

        // bind volume
        if (this.volume) {
            const [min, maj] = this.volume.minMaj();
            const aabb = this.volume.aabbClipped(this.settings.volumeClipMin, this.settings.volumeClipMax);
            this.gl.uniform3fv(this.getUniformLocation("u_volume_aabb"), new Float32Array(aabb.flat()));
            this.gl.uniform1f(this.getUniformLocation("u_volume_min"), min * this.densityScale * this.settings.densityMultiplier);
            this.gl.uniform1f(this.getUniformLocation("u_volume_maj"), maj * this.densityScale * this.settings.densityMultiplier);
            this.gl.uniform1f(this.getUniformLocation("u_volume_inv_maj"), 1 / (maj * this.densityScale * this.settings.densityMultiplier))

            this.gl.uniform3f(this.getUniformLocation("u_volume_albedo"), 0.9, 0.9, 0.9) // TODO
            this.gl.uniform1f(this.getUniformLocation("u_volume_phase_g"), 0) // TODO
            this.gl.uniform1f(this.getUniformLocation("u_volume_density_scale"), this.densityScale * this.settings.densityMultiplier);

            const combinedMatrix = this.volume.combinedTransform()
            this.gl.uniformMatrix4fv(this.getUniformLocation("u_volume_density_transform"), false, combinedMatrix)
            this.gl.uniformMatrix4fv(this.getUniformLocation("u_volume_density_transform_inv"), false, combinedMatrix.invert())
        }

        // bind environment
        if (this.environment) {
            textureOffset = this.environment.bindUniforms(this.program, textureOffset)
        }
        this.gl.uniform1i(this.getUniformLocation("show_environment"), this.settings.showEnvironment ? 1 : 0);
        this.gl.uniform1i(this.getUniformLocation("bounces"), this.settings.bounces)
        this.gl.uniform1i(this.getUniformLocation("u_use_env"), this.settings.useEnv ? 1 : 0);

        // bind sample range
        this.gl.uniform2f(this.getUniformLocation("u_sample_range"), ...this.settings.sampleRange);

        // bind previous frame
        this.gl.activeTexture(this.gl.TEXTURE0 + textureOffset + framebuffer);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.framebuffers[framebuffer].target);
        this.gl.uniform1i(this.getUniformLocation("u_previous_frame"), textureOffset + framebuffer);
        textureOffset += this.framebuffers.length;

        this.gl.uniform1ui(this.getUniformLocation("u_frame_index"), this.frameIndex);

        this.gl.uniform2i(this.getUniformLocation("u_res"), this.resolutionFactor * this.gl.canvas.width, this.resolutionFactor * this.gl.canvas.height)
        this.gl.uniform1i(this.getUniformLocation("u_debugHits"), this.settings.debugHits ? 1 : 0);

        this.gl.uniform1f(this.getUniformLocation("u_sample_weight"), this.frameIndex < this.lowResolutionDuration ? 0 : (this.frameIndex - this.lowResolutionDuration) / (this.frameIndex - this.lowResolutionDuration + 1));
    }

    private lastCurrentCubeFace: number | null = null;
    private lastWorldPos: Vector3 | null = null;

    private currentCubeFace(aabb = this.volume!.aabbClipped(this.settings.volumeClipMin, this.settings.volumeClipMax)) {
        if (this.adjustingClipping) return this.lastCurrentCubeFace;
        if (!this.mousePos) return null;
        const [hitMin] = rayBoxIntersectionPositions(worldRay(this.gl!, this.camera!, this.mousePos), aabb) ?? [null];
        this.lastWorldPos = hitMin;
        return this.lastCurrentCubeFace = cubeFace(aabb, hitMin);
    }

    private static readonly faceNormals = [
        new Vector3(0, 0, 1),
        new Vector3(0, 0, -1),
        new Vector3(-1, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(0, 1, 0),
        new Vector3(0, -1, 0),
    ]

    private currentCubeFaceLine(): Ray | null {
        const face = this.currentCubeFace();
        if (face === null || !this.lastWorldPos) return null;
        const normal = Volxel3DDicomRenderer.faceNormals[face]
        return {
            origin: this.lastWorldPos.clone(),
            direction: normal.clone()
        }
    }

    private getNewClosestToCubeFaceLine(): Vector3 | null {
        const cubeLine = this.currentCubeFaceLine();
        if (!cubeLine || !this.mousePos) return null;
        const cameraLine = worldRay(this.gl!, this.camera!, this.mousePos);

        const [pOnCubeLine] = closestPoints(cubeLine, cameraLine) ?? [null]
        return pOnCubeLine;
    }

    private rescaleAABBFromClippingInput() {
        if (!this.volume) return;
        const aabb = this.volume!.aabb()
        const cubeLine = this.currentCubeFaceLine();
        if (cubeLine === null) return;
        const face = this.currentCubeFace();
        if (face === null) return;
        const newPos = this.getNewClosestToCubeFaceLine();
        if (!newPos) return;
        const [min, max] = aabb;
        switch (face) {
            // +z, front
            case 0: {
                this.settings.volumeClipMax.z = Math.min(Math.max(this.settings.volumeClipMin.z + 0.1, 1 - (max.z - newPos.z) / (max.z - min.z)), 1)
                break;
            }
            // -z, back
            case 1: {
                this.settings.volumeClipMin.z = Math.max(Math.min(this.settings.volumeClipMax.z - 0.1, 1 - (max.z - newPos.z) / (max.z - min.z)), 0)
                break;
            }
            // -x, left
            case 2: {
                this.settings.volumeClipMin.x = Math.max(Math.min(this.settings.volumeClipMax.x - 0.1, 1 - (max.x - newPos.x) / (max.x - min.x)), 0)
                break;
            }
            // +x, right
            case 3: {
                this.settings.volumeClipMax.x = Math.min(Math.max(this.settings.volumeClipMin.x + 0.1, 1 - (max.x - newPos.x) / (max.x - min.x)), 1)
                break;
            }
            // +y, top
            case 4: {
                this.settings.volumeClipMax.y = Math.min(Math.max(this.settings.volumeClipMin.y + 0.1, 1 - (max.y - newPos.y) / (max.y - min.y)), 1)
                break;
            }
            // -y, bottom
            case 5: {
                this.settings.volumeClipMin.y = Math.max(Math.min(this.settings.volumeClipMax.y - 0.1, 1 - (max.y - newPos.y) / (max.y - min.y)), 0)
                break;
            }
        }
    }

    public set renderMode(to: VolxelRenderMode) {
        this.settings.renderMode = to;
        this.setAttribute("data-render-mode", to)
    }

    public get renderMode() {
        const attr = this.getAttribute("data-render-mode");
        if (attr === null) return VolxelRenderMode.DEFAULT;
        if (!Object.values(VolxelRenderMode).includes(attr as VolxelRenderMode)) throw new Error(`Unrecognized render mode provided: ${attr}`);
        return attr as VolxelRenderMode
    }
}

export function registerVolxelComponents(worker: () => Worker) {
    workerFactory = worker;
    customElements.define("volxel-slider", Slider);
    customElements.define("volxel-histogram-viewer", HistogramViewer);
    customElements.define("volxel-cube-direction", UnitCubeDisplay);
    customElements.define("volxel-colorramp", ColorRampComponent);
    customElements.define("volxel-3d-viewer", Volxel3DDicomRenderer);
}