import {css} from "./util.ts";

export class HistogramViewer extends HTMLElement {
    private canvas: HTMLCanvasElement;

    constructor() {
        super();

        this.attachShadow({mode: 'open'});

        this.shadowRoot!.adoptedStyleSheets.push(css`
            .histogramCanvas {
                width: 300px;
                aspect-ratio: 2;
                border: 1px solid white;
            }
        `)

        this.canvas = document.createElement("canvas");
        this.canvas.classList.add("histogramCanvas")
        this.shadowRoot!.appendChild(this.canvas);

        this.setupRenderEnvironment();
    }

    private setupRenderEnvironment() {
        // noop, maybe will make this use webgl if it stays
        const context = this.canvas.getContext("2d");
        if (!context) throw new Error("Failed to get 2d context for histogram viewer canvas");
    }

    public renderHistogram(histogram: Uint32Array) {
        const max = histogram.reduce((acc, cur, i) => i > 0 ? (cur > acc ? cur : acc) : acc, 0);
        const median = histogram.toSorted((a, b) => a - b)[Math.floor(histogram.length / 2)];
        // TODO: 300 here is chosen by playing around, I should probably be more nuanced with this
        const avg = histogram.reduce(([acc, i], cur) => cur > 10 ? [acc * (i / (i + 1)) + cur * (1 / (i + 1)), i + 1] : [acc, i], [0, 0])[0];
        console.log(median, avg);
        const lastIndexWithData = histogram.findLastIndex((count) => count > avg);
        console.log(lastIndexWithData);
        this.canvas.height = this.canvas.getBoundingClientRect().height;
        this.canvas.width = lastIndexWithData;

        const context = this.canvas.getContext("2d");
        if (!context) throw new Error("Failed to get 2d context for histogram viewer canvas");

        context.fillStyle = "#000000"
        context.fillRect(0, 0, this.canvas.width, this.canvas.height);
        context.fillStyle = "#FFFFFF";
        // TODO this could probably be optimized
        for (let i = 1; i < lastIndexWithData; i++) {
            if (histogram[i] > max / 2) console.log(i, histogram[i]);
            context.fillRect(i, 0, 1, histogram[i] / max * this.canvas.height);
        }
    }
}