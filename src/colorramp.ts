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

export class ColorRampComponent extends HTMLElement {
    private _colors: ColorStop[] = [{
        color: [1, 0, 0, 0],
        stop: 0
    }, {
        color: [0, 0, 1, 1],
        stop: 1
    }]

    private displayedColorDiv: HTMLDivElement;
    private controlsDiv: HTMLDivElement;

    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.shadowRoot!.adoptedStyleSheets.push(css`
            :host {
                flex: 1;
                display: flex;
            }
            
            .displayedColor {
                height: 20px;
                flex: 1;
                background: red;
            }
        `)

        this.displayedColorDiv = document.createElement("div");
        this.displayedColorDiv.classList.toggle("displayedColor", true);

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
        this.rerenderColors();
    }

    private rerenderColors() {
        this.controlsDiv.innerHTML = "";
        for (const stop of this.colors) {
            const stopControl = document.createElement("button");
            stopControl.classList.toggle("stopControl", true);

            stopControl.style.setProperty("--color", `rgba(${Math.round(stop.color[0] * 255)}, ${Math.round(stop.color[1] * 255)}, ${Math.round(stop.color[2] * 255)}, ${Math.round(stop.color[3] * 255)})`);

            this.controlsDiv.appendChild(stopControl);
        }
    }
}