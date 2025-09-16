import {css, html} from "../util";

export class Slider extends HTMLElement {
    static readonly observedAttributes = ["min", "max", "step"]

    private wrapped: HTMLInputElement;
    public connected: boolean = false;

    constructor() {
        super();

        this.attachShadow({ mode: 'open' });
        const contents = html`
            <input type="range" id="range_input">
            <div class="thumb"></div>
        `.content.cloneNode(true);
        this.shadowRoot!.appendChild(contents);

        this.shadowRoot!.adoptedStyleSheets.push(css`
            :host {
                display: flex;
                flex: 1;
                align-self: stretch;
                margin: 0;
                padding: 0;
                position: relative;
                min-height: 1.8em;

                input[type=range] {
                    width: 100%;
                    height: 100%;
                    appearance: none;
                    -webkit-appearance: none;
                    border: none;
                    background: none;
                    position: relative;
                    display: block;
                    margin: 0;
                    padding: 0;
                    cursor: grab;

                    &:active {
                        cursor: grabbing;
                    }
                }

                input[type=range]::-webkit-slider-runnable-track, input[type=range]::-moz-range-track {
                    background: white;
                    height: 1px;
                    opacity: 0.8;
                }

                input[type=range]::-moz-range-thumb, input[type=range]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    opacity: 0;
                }
            }
            div.thumb {
                position: absolute;
                pointer-events: none;
                top: -1px;
                bottom: -1px;
                background: #0005;
                backdrop-filter: blur(8px);
                border: 1px solid #777;
                left: calc(var(--value, 0) * (100% - 4ch));
                padding-inline: 3px;
                box-shadow: 0 0 2px black;
                //transform: translateX(-50%);
                display: flex;
                align-items: center;
                justify-content: center;
                width: 4ch;

                &:after {
                    position: relative;
                    content: var(--absolute-value, "0");
                    display: inline;
                }
            }
            input:is(:hover, :focus-visible) + .thumb {
                border-color: currentColor;
            }
        `)

        this.wrapped = this.shadowRoot!.getElementById("range_input") as HTMLInputElement;
    }

    connectedCallback() {
        this.wrapped = this.shadowRoot!.getElementById("range_input") as HTMLInputElement;
        this.setupFromAttributes();
        this.wrapped.addEventListener("change", () => {
            this.dispatchEvent(new CustomEvent("change"));
            this.setupSliderInfo();
        });
        this.wrapped.addEventListener("input", () => {
            this.dispatchEvent(new CustomEvent("input"));
            this.setupSliderInfo();
        });
        this.setupSliderInfo();
        this.dispatchEvent(new CustomEvent("connected"))
        this.connected = true;
    }

    attributeChangedCallback(name: string) {
        if (Slider.observedAttributes.includes(name)) {
            this.setupFromAttributes();
        }
    }

    private setupFromAttributes() {
        this.wrapped.min = this.getAttribute("min") ?? "";
        this.wrapped.max = this.getAttribute("max") ?? "";
        this.wrapped.step = this.getAttribute("step") ?? "0";
        this.setupSliderInfo();
    }

    private setupSliderInfo() {
        const step = this.getAttribute("step") ?? "1";
        const float = Number.parseFloat(step) !== Math.floor(Number.parseFloat(step));
        const precision = step.length - step.lastIndexOf(".") - 1
        const progress = (this.value - this.min) / (this.max - this.min);
        this.style.setProperty("--value", progress.toFixed(2))
        this.style.setProperty("--absolute-value", `"${float ? this.value.toFixed(precision) : this.value}"`)
    }

    public get value() {
        return this.wrapped.valueAsNumber;
    }
    public set value(value: number) {
        this.wrapped.valueAsNumber = value;
        this.setupSliderInfo();
    }

    public get min() {
        return Number.parseFloat(this.wrapped.min)
    }
    public get max() {
        return Number.parseFloat(this.wrapped.max)
    }
}