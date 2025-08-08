import {css, html} from "./util.ts";

export const volxelStyles = css`
    * {
        box-sizing: border-box;
    }
    
    :host {
        display: block;
        position: relative;
        margin: 0;
        padding: 0;
        min-width: 500px;
        min-height: 500px;
        font-family: system-ui, Avenir, Helvetica, Arial, sans-serif;
        line-height: 1.5;
        font-weight: 400;

        font-synthesis: none;
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
    }

    canvas#app {
        display: block;
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
    }

    div.controls {
        position: absolute;
        top: 0;
        left: 0;
        background: rgba(0,0,0,.9);
        padding: 10px;
        color: white;
        display: flex;
        flex-direction: column;
        gap: 10px;

        select {
            max-width: 200px;
        }

        &:has(input[name=hide]:checked) > *:not(:has(input[name=hide])) {
            display: none;
        }

        label {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 5px;
        }
    }

    div.loadingIndicator {
        position: absolute;
        inset: 0;
        background: #00000055;
        backdrop-filter: blur(10px);
        color: white;

        display: flex;
        pointer-events: none;
        opacity: 0;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        gap: 10px;
        transition-delay: 0s;

        &:before {
            content: "";
            display: block;
            position: relative;
            width: 60px;
            height: 60px;
            border: 3px solid white;
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 2s linear infinite;
        }
    }

    :host(.restarting) div.loadingIndicator {
        opacity: 1;
        pointer-events: all;
        transition-delay: .2s;
    }

    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`;

export const volxelTemplate: string =  html`
<canvas id="app"></canvas>
<div class="controls">
    <label>
        Max Samples
        <input type="range" name="samples" id="samples" min="1" max="3000" step="1">
    </label>
    <label>
        Select Transfer
        <input type="file" name="transfer_file" id="transfer_file">
    </label>
    <label>
        Use generated Transfer Function
        <input type="checkbox" name="generated_transfer" id="generated_transfer">
    </label>
    <color-ramp-component id="color-ramp"></color-ramp-component>
    <label>
        Density Multiplier
        <input type="range" name="density_multiplier" id="density_multiplier" min="0.01" max="2" step="0.01">
    </label>
    <volxel-histogram-viewer id="histogram"></volxel-histogram-viewer>
    <volxel-cube-direction id="direction"></volxel-cube-direction>
</div>
<div class="loadingIndicator">
    Volumetrische Daten werden geladen...
</div>
`