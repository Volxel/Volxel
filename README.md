# Volxel
An open source volumetric renderer for the Browser. Also my bachelor's thesis.

## Status
Currently, it shows a volumetric sinusoid in white, in front of a blue background.
## Development

1. Install PNPM (https://pnpm.io)
2. Install `wasm-pack`, via
   ```shell
   pnpm i -g wasm-pack
   ```
3. Build the wasm binary
   ```shell
   pnpm build:wasm
   ```
4. Install the dependencies (Using https://pnpm.io)
    ```shell
    pnpm i
    ```
5. Run the Vite development server
    ```shell
    pnpm dev
    ```
6. Open [http://localhost:5173/Volxel](http://localhost:5173/Volxel) in a browser that supports WebGL 2.0