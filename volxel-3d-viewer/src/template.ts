import {css, html} from "./util";

export const volxelStyles = css`
    * {
        box-sizing: border-box;
    }
    
    :host {
        display: block;
        position: relative;
        margin: 0;
        padding: 0;
        width: 100%;
        min-height: 500px;
        font-family: system-ui, Avenir, Helvetica, Arial, sans-serif;
        line-height: 1.5;
        font-weight: 400;

        font-synthesis: none;
        text-rendering: optimizeLegibility;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        overflow: hidden;
        background: var(--volxel-color-background, black);
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
        max-width: calc(100% - 30px);
        width: 300px;
        transform: translateX(-100%);
        transition: .1s;
        --highlight-color: var(--volxel-highlight-color, #444);
        border-right: 1px solid var(--highlight-color);
        
        display: flex;
        flex-direction: column;
        
        &:has(input#menu:checked) {
            transform: translateX(0);
        }
        
        div.tabbar {
            display: none;
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
                    opacity: 0;
                }
            }
        }
        &:has(input#menu:checked) div.tabbar {
            display: flex;
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
        &:has(input#light:checked):has(input#menu:checked) div#light-tab {
            display: flex;
        }
        &:has(input#transfer:checked):has(input#menu:checked) div#transfer-tab {
            display: flex;
        }
        &:has(input#render:checked):has(input#menu:checked) div#render-tab {
            display: flex;
        }

        label.menuButton {
            position: absolute;
            bottom: 0;
            left: 100%;
            background: black;
            border-top: 1px solid #444;
            border-right: 1px solid #444;
            width: 2em;
            height: 2em;
            cursor: pointer;

            > span, > input {
                position: absolute;
                width: 0;
                height: 0;
                overflow: hidden;
                opacity: 0;
            }

            &:has(input:is(:hover, :focus-visible)) {
                background: #444;
            }
            
            div {
                width: 100%;
                height: 100%;
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: space-between;
                padding: 30%;
                
                span {
                    display: block;
                    height: 1px;
                    background: white;
                    transition: .1s;
                    width: 60%;
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    &:first-child {
                        top: 30%;
                    }
                    &:last-child {
                        top: 70%;
                    }
                }
            }
            &:has(input:checked) {
                div {
                    span:nth-child(2) {
                        opacity: 0;
                    }
                    span:nth-child(2n + 1) {
                        width: 60%;
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%) rotate(-45deg);
                        &:nth-child(1) {
                            transform: translate(-50%, -50%) rotate(45deg);
                        }
                    }
                }
            }
        }
    }

    div.loadingIndicator, div.errorIndicator {
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
    }
    div.loadingIndicator {
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
    div.errorIndicator {
        color: red;
    }

    :host(.restarting) div.loadingIndicator {
        opacity: 1;
        pointer-events: all;
        transition-delay: .2s;
    }
    :host(.errored) div.errorIndicator {
        opacity: 1;
        pointer-events: all;
        transition-delay: .2s;
    }

    @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
    }
`;

export const volxelTemplate: HTMLTemplateElement =  html`
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
        <label>
            Upload Environment Map HDR
            <input type="file" name="light_env" id="light_env" accept="image/aces">
        </label>
        <label>
            <input type="checkbox" name="use_env" id="use_env">
            Use environment
        </label>
        <label>
            <input type="checkbox" name="env_show" id="env_show">
            Show Environment
        </label>
        <label>
            Environment Strength
            <volxel-slider id="env_strength" min="0.01" max="2" step="0.01"></volxel-slider>
        </label>
        <label>
            <input type="checkbox" name="light_backlight" id="light_backlight">
            Backlight
        </label>
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
            <input type="checkbox" name="generated_transfer" id="generated_transfer">
            Use generated transfer function
        </label>
        <volxel-colorramp id="color-ramp"></volxel-colorramp>
        <label>
            Density Multiplier
            <volxel-slider id="density_multiplier" min="0.01" max="2" step="0.01"></volxel-slider>
        </label>
        <volxel-histogram-viewer id="histogram"></volxel-histogram-viewer>
        <button type="button" id="export-transfer">Export Transfer Settings</button>
        <label>
            Import Transfer Settings
            <input type="file" name="import-transfer" id="import-transfer">
        </label>
    </div>
    <div class="tab" id="render-tab">
        <label>
            Max Samples
            <volxel-slider id="samples" min="1" max="3000" step="1"></volxel-slider>
        </label>
        <label>
            Max Bounces
            <volxel-slider id="bounces" min="1" max="20" step="1"></volxel-slider>
        </label>
        <label>
            Gamma
            <volxel-slider id="gamma" min="0.01" max="5" step="0.01"></volxel-slider>
        </label>
        <label>
            Exposure
            <volxel-slider id="exposure" min="0.01" max="8" step="0.01"></volxel-slider>
        </label>
        <label>
            <input type="checkbox" name="debugHits" id="debugHits" >
            Debug Hit Positions
        </label>
    </div>
    <label class="menuButton">
        <span class="label">Menü</span>
        <input type="checkbox" name="menu" id="menu">

        <div aria-hidden>
            <span></span>
            <span></span>
            <span></span>
        </div>
    </label>
</div>
<div class="loadingIndicator">
    Loading and preparing volumetric data ...
</div>
<div class="errorIndicator">
    An error occurred:
    <span id="error"></span>
</div>
`