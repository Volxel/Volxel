import { defineConfig } from "vite";
import glslIncludePlugin from "./vite-plugin-glsl-include";

export default defineConfig({
    plugins: [glslIncludePlugin()]
})