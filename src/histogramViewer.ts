import {css} from "./util.ts";

export class HistogramViewer extends HTMLElement {
    private canvas: HTMLCanvasElement;
    private buttons: [HTMLButtonElement, HTMLButtonElement]
    private max: number = 0;

    private selectedRange: [number, number] = [0, 1];

    constructor() {
        super();

        this.attachShadow({mode: 'open'});

        this.shadowRoot!.adoptedStyleSheets.push(css`
            * {
                box-sizing: border-box;
            }
            :host {
                border: 1px solid white;
                padding: 3px;
                align-self: flex-start;
            }
            div {
                position: relative;
            }
            .histogramCanvas {
                width: 300px;
                aspect-ratio: 16 / 9;
            }
            button {
                appearance: none;
                position: absolute;
                top: 0;
                bottom: 0;
                width: 6px;
                background: transparent;
                display: flex;
                flex-direction: column;
                align-items: center;
                border: 1px solid transparent;
                left: calc(((100% - 3px) * var(--temp-offset, var(--relative-position, 0))));
                transform: translateX(-3px);
                cursor: pointer;
                
                &:hover {
                    border-color: red;
                }
                
                &:after {
                    flex: 1;
                    width: 1px;
                    background: red;
                    content: "";
                    display: block;
                }
            }
        `)

        this.canvas = document.createElement("canvas");
        this.canvas.classList.add("histogramCanvas")

        const container = document.createElement("div");

        container.appendChild(this.canvas);

        const button1 = document.createElement("button");
        const button2 = document.createElement("button");

        this.buttons = [button1, button2];

        for (const [i, button] of [[0, button1], [1, button2]] as [number, HTMLButtonElement][]) {
            button.style.setProperty("--relative-position", `${this.selectedRange[i]}`)
            let dragStart = -1;
            let dragging = false;
            const calculatePositionInButton = (x: number) => {
                const bounding = container.getBoundingClientRect();
                return Math.min(Math.max((x - bounding.left) / bounding.width, 0), 1);
            }
            const moveListener = (event: MouseEvent) => {
                if (Math.abs(event.clientX - dragStart) > 10) {
                    dragging = true

                    button.style.setProperty("--temp-offset", `${calculatePositionInButton(event.clientX)}`)
                }
            }
            const upListener = (event: MouseEvent) => {
                if (dragging) {
                    this.selectedRange[i] = calculatePositionInButton(event.clientX);
                    this.emitChange()
                    button.style.removeProperty("--temp-offset");
                    button.style.setProperty("--relative-position", `${this.selectedRange[i]}`)
                }
                dragging = false;
                dragStart = -1;

                document.removeEventListener("mousemove", moveListener);
                document.removeEventListener("mouseup", upListener);
            }
            button.addEventListener("mousedown", (event) => {
                dragStart = event.clientX;
                document.addEventListener("mousemove", moveListener);
                document.addEventListener("mouseup", upListener);
            });
        }

        container.appendChild(button1);
        container.appendChild(button2);

        this.shadowRoot!.appendChild(container);

        this.setupRenderEnvironment();
    }

    private setupRenderEnvironment() {
        // noop, maybe will make this use webgl if it stays
        const context = this.canvas.getContext("2d");
        if (!context) throw new Error("Failed to get 2d context for histogram viewer canvas");
    }

    public renderHistogram(histogram: Uint32Array) {
        const max = histogram.reduce((acc, cur, i) => i > 0 ? (cur > acc ? cur : acc) : acc, 0);

        // TODO: This setup was chosen fairly arbitrarily, maybe there are better ones
        const median = histogram.toSorted((a, b) => a - b)[Math.floor(histogram.length / 2)];
        const lastIndexWithData = histogram.findLastIndex((count) => count > median);
        console.log(lastIndexWithData);

        this.canvas.height = this.canvas.getBoundingClientRect().height * 10;
        this.canvas.width = lastIndexWithData;
        this.max = lastIndexWithData;

        this.selectedRange = [0, 1];
        this.buttons[0].style.setProperty("--relative-position", `${0}`)
        this.buttons[1].style.setProperty("--relative-position", `${1}`)

        const context = this.canvas.getContext("2d");
        if (!context) throw new Error("Failed to get 2d context for histogram viewer canvas");

        context.fillStyle = "#000000"
        context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        context.fillStyle = "#FFFFFF";
        // TODO this could probably be optimized
        for (let i = 1; i < lastIndexWithData; i++) {
            context.fillRect(i, 0, 1, histogram[i] / max * this.canvas.height);
        }
    }

    private emitChange() {
        const min = Math.min(...this.selectedRange);
        const max = Math.max(...this.selectedRange);
        this.dispatchEvent(new CustomEvent("change", { detail: [Math.floor(this.max * min), Math.ceil(this.max * max)]}))
    }
}