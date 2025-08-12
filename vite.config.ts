import { resolve } from "path";
import { defineConfig } from "vite";
import glslIncludePlugin from "./vite-plugin-glsl-include";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
    plugins: [glslIncludePlugin(), wasm(), topLevelAwait()],
    base: "/Volxel",
    assetsInclude: ["**/*.dcm"],
    appType: "mpa",
    optimizeDeps: {
        exclude: ["dicom_preprocessor"]
    },
    resolve: {
        alias: [{
            find: "@volxel/3d-viewer",
            replacement: resolve(__dirname, "./volxel-3d-viewer/src")
        }]
    }
})