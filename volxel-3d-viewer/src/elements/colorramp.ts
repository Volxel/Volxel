import {ColorStop} from "../data";
import {css, html} from "../util";

function buildHeightsSVG(stops: ColorStop[]): SVGSVGElement {
    const NS = "http://www.w3.org/2000/svg";

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 1 1")
    svg.setAttribute("preserveAspectRatio", "none")

    const defs = document.createElementNS(NS, "defs");
    const g = document.createElementNS(NS, "linearGradient");
    g.setAttribute("id", "gradient");
    g.setAttribute("x1", "0");
    g.setAttribute("y1", "0");
    g.setAttribute("x2", "1");
    g.setAttribute("y2", "0");

    for (const stop of stops) {
        const stopEl = document.createElementNS(NS, "stop");
        stopEl.setAttribute("offset", "" + stop.stop);
        stopEl.setAttribute("stop-color", `rgb(${Math.round(stop.color[0] * 255)}, ${Math.round(stop.color[1] * 255)}, ${Math.round(stop.color[2] * 255)})`);

        g.appendChild(stopEl);
    }

    defs.appendChild(g);
    svg.appendChild(defs);

    const poly = document.createElementNS(NS, "polygon");
    const points = [
        [0, 1 - stops[0].color[3]],
        ...stops.map(stop => [stop.stop, 1 - stop.color[3]]),
        [1, 1 - stops[stops.length - 1].color[3]],
        [1, 1]
    ]
    poly.setAttribute("points", points.map(([x, y]) => `${x},${y}`).join(" "));
    poly.id = "height-polygon"
    poly.setAttribute("fill", "url(#gradient)")

    svg.appendChild(poly);
    return svg;
}

const colorRegexp = /[0-9]*[,)]/g;

const dialogTemplate = html`
    <form method="dialog" id="form">
        <label>
            Set color
            <input type="color" id="color" name="color">
        </label>
        <label>
            Set density
            <input type="range" name="density" id="density" min="0" max="1" step="0.001">
        </label>
        <button type="submit" value="save">Save</button>
    </form>
`

export class ColorRampComponent extends HTMLElement {
    private _colors: ColorStop[] = [{
        color: [1, 0, 0, 0],
        stop: 0,
    },{
        color: [0, 1, 1, 1],
        stop: 1
    }]

    private displayedColorDiv: HTMLDivElement;
    private controlsDiv: HTMLDivElement;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot!.adoptedStyleSheets.push(css`
            :host {
                display: flex;
                position: relative;
                background-image: repeating-conic-gradient(#222 0% 25%, #444 0% 50%);
                background-position: 0 0, 32px 32px;
                background-size: 64px 64px;
                background-color: #444;
                padding: 3px;
                border: 1px solid white;
            }
            
            .displayedColor {
                height: 58px;
                flex: 1;
                cursor: text;
                
                svg {
                    height: 100%;
                    width: 100%;
                }
            }
            
            button.stopControl {
                --width: 10px;
                left: calc(6px + var(--temp-offset, var(--offset)) * (100% - 3px) - 0.5 * var(--width));
                top: -2px;
                bottom: -2px;
                position: absolute;
                appearance: none;
                padding: 0;
                margin: 0;
                
                box-sizing: border-box;
                width: var(--width);
                transform: translateX(-50%);
                border: 2px solid white;
                background: var(--color);
                cursor: grab;
                box-shadow: 0 0 2px black, inset 0 0 2px black;
                
                &:hover, &:focus-visible, &:active {
                    top: -3px;
                    bottom: -3px;
                    outline: 1px solid var(--inv);
                    box-shadow: 0 0 5px black, inset 0 0 1px black;
                }
                &:active {
                    cursor: grabbing;
                }
            }
        `)

        this.displayedColorDiv = document.createElement("div");
        this.displayedColorDiv.classList.toggle("displayedColor", true);
        this.displayedColorDiv.addEventListener("click", (e) => {
            const bounds = this.displayedColorDiv.getBoundingClientRect();
            const relative = (e.clientX - bounds.left) / (bounds.width);

            let stopBefore: ColorStop | undefined;
            let stopAfter: ColorStop | undefined;
            for (const stop of this.colors) {
                if (stop.stop < relative) stopBefore = stop;
                if (stop.stop > relative) stopAfter = stop;
            }

            const mappedRelativeProgress = (relative - (stopBefore?.stop ?? 0)) / ((stopAfter?.stop ?? 1) - (stopBefore?.stop ?? 0))

            if (!stopBefore && !stopAfter) throw new Error("Initial stop placing not yet supported")
            const fromColor = stopBefore?.color ?? stopAfter!.color;
            const toColor = stopAfter?.color ?? stopBefore!.color;

            const mixedColor: ColorStop["color"] = fromColor.map((c, i) => (1 - mappedRelativeProgress) * c + mappedRelativeProgress * toColor[i]) as ColorStop["color"];

            this.colors = [...this.colors, {
                color: mixedColor,
                stop: relative
            }]
        })
        this.shadowRoot!.appendChild(this.displayedColorDiv);

        this.controlsDiv = document.createElement("div");
        this.shadowRoot!.appendChild(this.controlsDiv);
        this.rerenderColors();
    }

    public get colors(): ColorStop[] {
        return this._colors;
    }
    public set colors(colors: ColorStop[]) {
        this._colors = colors;
        this.sortColors();
        this.rerenderColors();
        this.dispatchEvent(new CustomEvent("change", { detail: this.colors }))
    }

    private sortColors() {
        this.colors.sort((a, b) => a.stop - b.stop);
    }

    private rerenderColors() {
        this.controlsDiv.innerHTML = "";
        const gradientSteps: string[] = [];
        for (const stop of this.colors) {
            const hex = `#${Math.round(stop.color[0] * 255).toString(16).padStart(2, "0")}${Math.round(stop.color[1] * 255).toString(16).padStart(2, "0")}${Math.round(stop.color[2] * 255).toString(16).padStart(2, "0")}`
            const withoutAlpha = `rgb(${Math.round(stop.color[0] * 255)}, ${Math.round(stop.color[1] * 255)}, ${Math.round(stop.color[2] * 255)})`;
            const inv = `rgb(${255-Math.round(stop.color[0] * 255)}, ${255-Math.round(stop.color[1] * 255)}, ${255-Math.round(stop.color[2] * 255)})`;

            const wrapper = document.createElement("div");
            const stopControl = document.createElement("button");
            const dialog = document.createElement("dialog");

            const contents = dialogTemplate.content.cloneNode(true);
            dialog.appendChild(contents);
            const colorInput = dialog.querySelector("#color") as HTMLInputElement;
            const densityInput = dialog.querySelector("#density") as HTMLInputElement;
            colorInput.value = hex;
            densityInput.valueAsNumber = stop.color[3]

            const onInput = (_event: Event) => {
            }
            colorInput.addEventListener("change", onInput)
            wrapper.appendChild(dialog);
            wrapper.appendChild(stopControl);
            dialog.addEventListener("close", () => {
                if (dialog.returnValue !== "save") return;
                colorInput.style.setProperty("color", colorInput.value);
                const computedColor = getComputedStyle(colorInput).color;
                const parsedColor = ([...computedColor.matchAll(colorRegexp)]
                        .map(match => match[0].substring(0, match[0].length - 1))
                        .map(number => Number.parseInt(number) / 255)
                );
                stop.color = (parsedColor.length === 4 ? parsedColor : [...parsedColor, densityInput.valueAsNumber]) as [number, number, number, number]
                this.sortColors();
                this.rerenderColors();
                this.dispatchEvent(new CustomEvent("change", { detail: this.colors }))
            })

            stopControl.addEventListener("click", () => {
                dialog.showModal();
            })

            let dragging = false;
            let startX = 0;

            stopControl.addEventListener("mousedown", (e) => {
                dragging = false;
                startX = e.clientX;

                const onMouseMove = (e: MouseEvent) => {
                    if (Math.abs(e.clientX - startX) > 5) {
                        dragging = true;
                        const relativeOffset = (e.clientX - startX) / this.displayedColorDiv.clientWidth;
                        stopControl.style.setProperty("--temp-offset", "" + Math.min(1.0, Math.max(0.0, stop.stop + relativeOffset)))
                    }
                }

                const onMouseUp = (e: MouseEvent) => {
                    document.removeEventListener("mousemove", onMouseMove);
                    document.removeEventListener("mouseup", onMouseUp);

                    if (dragging) {
                        const relativeOffset = (e.clientX - startX) / this.displayedColorDiv.clientWidth;
                        stop.stop = Math.min(1.0, Math.max(0.0, stop.stop + relativeOffset));
                        this.sortColors();
                        this.rerenderColors();
                        this.dispatchEvent(new CustomEvent("change", { detail: this.colors }))
                    }
                }

                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup", onMouseUp);
            })

            stopControl.addEventListener("contextmenu", (e: MouseEvent) => {
                e.preventDefault();
                if (this.colors.length < 2) alert("Cannot delete last color stop")
                else this.colors = this.colors.filter(it => it !== stop)
            })
            stopControl.classList.toggle("stopControl", true);

            stopControl.style.setProperty("--color", withoutAlpha);
            stopControl.style.setProperty("--inv", inv);
            stopControl.style.setProperty("--offset", stop.stop + "")
            gradientSteps.push(`${withoutAlpha} ${Math.round(stop.stop * 100)}%`)

            this.controlsDiv.appendChild(wrapper);
        }
        this.displayedColorDiv.style.setProperty("--gradient", `linear-gradient(to right, ${gradientSteps.join(", ")})`);
        this.displayedColorDiv.innerHTML = "";
        this.displayedColorDiv.appendChild(buildHeightsSVG(this.colors))
    }
}