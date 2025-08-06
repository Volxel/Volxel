import {css} from "../util.ts";
import {Vector3} from "math.gl";

export class DirectionSelector extends HTMLElement {
    public static readonly observedAttributes = ["direction"];

    public get direction(): Vector3 {
        const [x, y, z] = JSON.parse(this.getAttribute("direction") ?? "[0, 0, 1]")
        return new Vector3(x, y, z);
    }
    public set direction(value: Vector3) {
        this.setAttribute("direction", JSON.stringify(value));
    }

    constructor() {
        super();

        this.attachShadow({mode: "open"});

        this.shadowRoot!.adoptedStyleSheets.push(css`
            :host {
                width: 300px;
                height: 300px;
                background: var(--direction-selector-background, #444444);
                display: grid;
                align-items: center;
                justify-items: center;
                perspective: 100px;
                --box-thickness: 20px;
            }
            .box {
                width: var(--box-thickness);
                height: var(--box-thickness);
                position: relative;
                transform-style: preserve-3d;
                transform-origin: center center;
                transform: var(--rotation);
                pointer-events: none;
            }
            .face {
                position: absolute;
                background: var(--face-color);
                opacity: 0.9;
                text-align: center;
                top: 0;
                left: 0;
            }
            .face.left {
                width: calc(4 * var(--box-thickness));
                height: var(--box-thickness);
                transform: rotateY(-90deg) translateZ(calc(2 * var(--box-thickness))) ;
            }
            .face.right {
                width: calc(4 * var(--box-thickness));
                height: var(--box-thickness);
                transform: rotateY(90deg) translateZ(calc(-1 * var(--box-thickness)));
            }
            .face.top {
                height: calc(1 * var(--box-thickness));
                width: calc(4 * var(--box-thickness));
                transform: rotateZ(90deg) rotateY(90deg) rotateX(0deg) translateZ(calc(-0.5 * var(--box-thickness))) translateY(calc(1.5 * var(--box-thickness)));
            }
            .face.bottom {
                height: calc(1 * var(--box-thickness));
                width: calc(4 * var(--box-thickness));
                transform: rotateZ(90deg) rotateY(90deg) rotateX(0deg) translateZ(calc(0.5 * var(--box-thickness))) translateY(calc(1.5 * var(--box-thickness)));
            }
            .face.front {
                width: var(--box-thickness);
                height: var(--box-thickness);
                transform: translateZ(calc(0.5 * 4 * var(--box-thickness)))
            }
            .face.back {
                width: var(--box-thickness);
                height: var(--box-thickness);
                transform: translateZ(calc(-0.5 * 4 * var(--box-thickness)))
            }
        `)

        this.style.setProperty("--rotation", this.calculateRotation());

        const box = document.createElement("div");
        box.classList.add("box");
        let color = 0;
        for (let face of ["front", "back", "right", "left", "top", "bottom"]) {
            const faceDiv = document.createElement("div");
            faceDiv.classList.add("face", face);
            faceDiv.innerText = [".", "o", "<--", "-->", "<--", "<--"][color]
            faceDiv.style.setProperty("--face-color", ["#990000", "#009900", "#000099", "#990099", "#009999", "#999900"][color++])
            box.appendChild(faceDiv);
        }
        this.shadowRoot!.appendChild(box);
    }

    public attributeChangedCallback(name: string) {
        switch (name) {
            case "direction": {
                this.style.setProperty("--rotation", this.calculateRotation());
                break;
            }
        }
    }

    private calculateRotation(): string {
        const theta = Math.acos(this.direction.z);
        const ax = -this.direction.y, ay = this.direction.x, az = 0;
        return `rotate3d(${ax},${ay},${az},${theta}rad)`
    }
}