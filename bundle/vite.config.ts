import {defineConfig} from "vite";
import wasm from "vite-plugin-wasm";
import dtsPlugin from "vite-plugin-dts";
import tsconfigPaths from "vite-tsconfig-paths";
import glslIncludePlugin from "../vite-plugin-glsl-include";
import {resolve} from "path";

export default defineConfig({
    worker: {
        plugins: () => [
            wasm()
        ],
        format: "es",
        rollupOptions: {
            output: {
                file: "./dicom_wasm_worker.mjs",
            },
        }
    },
    plugins: [
        glslIncludePlugin(),
        tsconfigPaths(),
    ],
    optimizeDeps: {
        exclude: ["dicom_preprocessor"]
    },
    build: {
        lib: {
            entry: "src/index",
            formats: ["es"],
            fileName: "index"
        },
        rollupOptions: {
            external: ["./worker.mjs"]
        }
    },
    resolve: {
        alias: [{
            find: "@volxel/3d-viewer",
            replacement: resolve(__dirname, "../volxel-3d-viewer/src")
        }]
    }
})