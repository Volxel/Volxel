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
        bottom: 0;
        background: var(--volxel-color-ui, black);
        color: var(--volxel-color-text-ui, white);
        max-width: 100%;
        width: 300px;
        --highlight-color: var(--volxel-highlight-color, #444);
        border-right: 1px solid var(--highlight-color);
        
        display: flex;
        flex-direction: column;
        
        div.tabbar {
            display: flex;
            width: 100%;
            height: max-content;
            flex-shrink: 0;
            overflow-x: auto;
            font-size: .8em;
            
            label {
                flex-shrink: 0;
                flex-grow: 1;
                text-align: center;
                display: block;
                padding: 3px;
                user-select: none;
                cursor: pointer;
                background: #4449;
                border-bottom: 1px solid var(--highlight-color);
                
                &:not(:last-child) {
                    border-right: 1px solid var(--highlight-color)
                }
                &:has(input:checked) {
                    background: transparent;
                    border-bottom-color: transparent;
                }
                &:has(input:is(:hover, :focus-visible)) {
                    background: #444f;
                }
                
                input {
                    position: absolute;
                    height: 0;
                    width: 0;
                    overflow: hidden;
                    cursor: pointer;
                }
            }
        }
        div.tab {
            display: none;
            flex: 1;
            overflow-y: auto;
            
            flex-direction: column;
            padding: 10px;
            gap: 10px;
            
            label {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 3px;
                &:has(input[type=checkbox]) {
                    flex-direction: row;
                    align-items: center;
                }
                
                input:not([type=checkbox]) {
                    flex: 1;
                    width: 100%;
                }
            }
        }
        &:has(input#light:checked) div#light-tab {
            display: flex;
        }
        &:has(input#transfer:checked) div#transfer-tab {
            display: flex;
        }
        &:has(input#render:checked) div#render-tab {
            display: flex;
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
    <div class="tabbar">
        <label>
            <input type="radio" name="tab" id="light" checked>
            Lighting
        </label>
        <label>
            <input type="radio" name="tab" id="transfer">
            Transfer function
        </label>
        <label>
            <input type="radio" name="tab" id="render">
            Display
        </label>
    </div>
    <div class="tab" id="light-tab">
        <div>
            Light direction
            <volxel-cube-direction id="direction"></volxel-cube-direction>
        </div>
    </div>
    <div class="tab" id="transfer-tab">
        <label>
            Upload transfer function
            <input type="file" name="transfer_file" id="transfer_file">
        </label>
        <label>
            Use generated transfer function
            <input type="checkbox" name="generated_transfer" id="generated_transfer">
        </label>
        <color-ramp-component id="color-ramp"></color-ramp-component>
        <label>
            Density Multiplier
            <input type="range" name="density_multiplier" id="density_multiplier" min="0.01" max="2" step="0.01">
        </label>
        <volxel-histogram-viewer id="histogram"></volxel-histogram-viewer>
    </div>
    <div class="tab" id="render-tab">
        <label>
            Max Samples
            <input type="range" name="samples" id="samples" min="1" max="3000" step="1">
        </label>
    </div>
</div>
<div class="loadingIndicator">
    Volumetrische Daten werden geladen...
</div>
`