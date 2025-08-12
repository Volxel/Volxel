import {defineConfig} from "vite";
import wasm from "vite-plugin-wasm";
import dtsPlugin from "vite-plugin-dts";
import tsconfigPaths from "vite-tsconfig-paths";
import glslIncludePlugin from "../vite-plugin-glsl-include";

export default defineConfig({
    plugins: [
        dtsPlugin({
            insertTypesEntry: true,
            tsconfigPath: "./tsconfig.json",
            pathsToAliases: false,
            aliasesExclude: []
        }),
        glslIncludePlugin(),
        tsconfigPaths(),
        wasm()
    ],
    optimizeDeps: {
        exclude: ["dicom_preprocessor"]
    },
    build: {
        lib: {
            entry: "src/index",
            formats: ["es"],
            fileName: "index"
        }
    }
})