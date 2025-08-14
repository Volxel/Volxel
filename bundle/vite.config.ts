import {defineConfig} from "vite";
import wasm from "vite-plugin-wasm";
import dtsPlugin from "vite-plugin-dts";
import tsconfigPaths from "vite-tsconfig-paths";
import glslIncludePlugin from "../vite-plugin-glsl-include";

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
        dtsPlugin({
            insertTypesEntry: true,
            tsconfigPath: "./tsconfig.json",
            pathsToAliases: false,
            aliasesExclude: []
        }),
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
})