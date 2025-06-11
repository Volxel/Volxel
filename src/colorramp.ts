import {ColorStop} from "./data.ts";

function css(strings: TemplateStringsArray, ...props: any[]) {
    let string = "";
    for (let i = 0; i < strings.length; i++) {
        string += strings[i];
        if (i < props.length) string += props[i];
    }
    const stylesheet = new CSSStyleSheet();
    stylesheet.replaceSync(string);
    return stylesheet;
}

const colorRegexp = /[0-9]*[,)]/g;

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
    private colorInput: HTMLInputElement;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot!.adoptedStyleSheets.push(css`
            :host {
                flex: 1;
                display: flex;
                position: relative;
            }
            
            .displayedColor {
                height: 20px;
                flex: 1;
                background: var(--gradient);
            }
            
            button.stopControl {
                left: calc(var(--temp-offset, var(--offset)) * 100%);
                top: -1px;
                bottom: -1px;
                position: absolute;
                appearance: none;
                padding: 0;
                margin: 0;
                
                box-sizing: border-box;
                width: 4px;
                transform: translateX(-50%);
                border: 1px solid var(--inv);
                background: none;
                cursor: pointer;
            }
        `)

        this.displayedColorDiv = document.createElement("div");
        this.displayedColorDiv.classList.toggle("displayedColor", true);

        this.shadowRoot!.appendChild(this.displayedColorDiv);

        this.colorInput = document.createElement("input");
        this.colorInput.type = "color";
        this.colorInput.hidden = true;
        this.shadowRoot!.appendChild(this.colorInput);

        this.controlsDiv = document.createElement("div");
        this.shadowRoot!.appendChild(this.controlsDiv);
        this.rerenderColors();
    }

    public get colors(): ColorStop[] {
        return this._colors;
    }
    public set colors(colors: ColorStop[]) {
        this._colors = colors;
        this.rerenderColors();
        this.dispatchEvent(new CustomEvent("change", { detail: this.colors }))
    }

    private rerenderColors() {
        this.controlsDiv.innerHTML = "";
        const gradientSteps: string[] = [];
        for (const stop of this.colors) {
            const stopControl = document.createElement("button");
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
                        this.rerenderColors();
                        this.dispatchEvent(new CustomEvent("change", { detail: this.colors }))
                    }
                }

                document.addEventListener("mousemove", onMouseMove);
                document.addEventListener("mouseup", onMouseUp);
            })

            // Click listener to change
            stopControl.addEventListener("click", () => {
                if (dragging) return;
                const onInput = (_event: Event) => {
                    this.colorInput.style.setProperty("color", this.colorInput.value);
                    const computedColor = getComputedStyle(this.colorInput).color;
                    const parsedColor = ([...computedColor.matchAll(colorRegexp)]
                        .map(match => match[0].substring(0, match[0].length - 1))
                        .map(number => Number.parseInt(number) / 255)
                    );
                    stop.color = (parsedColor.length === 4 ? parsedColor : [...parsedColor, stop.color[3]]) as [number, number, number, number]
                    this.colorInput.removeEventListener("input", onInput);
                    this.rerenderColors();
                    this.dispatchEvent(new CustomEvent("change", { detail: this.colors }))
                }
                this.colorInput.addEventListener("input", onInput);
                this.colorInput.click();
            });
            stopControl.classList.toggle("stopControl", true);

            const color = `rgba(${Math.round(stop.color[0] * 255)}, ${Math.round(stop.color[1] * 255)}, ${Math.round(stop.color[2] * 255)}, ${Math.round(stop.color[3] * 255)})`;
            const inv = `rgb(${255-Math.round(stop.color[0] * 255)}, ${255-Math.round(stop.color[1] * 255)}, ${255-Math.round(stop.color[2] * 255)})`;
            stopControl.style.setProperty("--color", color);
            stopControl.style.setProperty("--inv", inv);
            stopControl.style.setProperty("--offset", stop.stop + "")
            gradientSteps.push(`${color} ${Math.round(stop.stop * 100)}%`)

            this.controlsDiv.appendChild(stopControl);
        }
        this.displayedColorDiv.style.setProperty("--gradient", `linear-gradient(to right, ${gradientSteps.join(", ")})`);
    }
}