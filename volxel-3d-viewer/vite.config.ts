import {defineConfig} from "vite";
import glslIncludePlugin from "../vite-plugin-glsl-include";
import wasm from "vite-plugin-wasm";
import dtsPlugin from "vite-plugin-dts";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
    worker: {
        plugins: () => [
            wasm()
        ],
        format: "es",
        rollupOptions: {
            output: {
                file: "dicom_wasm_worker.mjs",
            },
            external: ["@volxel/dicom_preprocessor"]
        }
    },
    plugins: [
        dtsPlugin({
            insertTypesEntry: true,
            tsconfigPath: "./tsconfig.json",
            pathsToAliases: false,
            aliasesExclude: []
        }),
        tsconfigPaths(),
        glslIncludePlugin(),
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
            external: [
                "@volxel/dicom_preprocessor",
                "math.gl"
            ]
        }
    }
})