import { defineConfig } from "vite";
import glslIncludePlugin from "./vite-plugin-glsl-include";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
    plugins: [glslIncludePlugin(), wasm(), topLevelAwait()],
    base: "/Volxel",
    assetsInclude: ["**/*.dcm"],
    appType: "mpa"
})