import "./index.css";

import ImportedWorker from "@volxel/3d-viewer/worker?worker"

import {registerVolxelComponents, Volxel3DDicomRenderer, VolxelBenchmark, VolxelRenderMode} from "@volxel/3d-viewer";

registerVolxelComponents(() => new ImportedWorker())

const renderer = document.getElementById("renderer") as Volxel3DDicomRenderer;

const dicomFileSelect = document.getElementById("dicom") as HTMLInputElement;
dicomFileSelect.addEventListener("change", async () => {
    const files = dicomFileSelect.files;
    if (!files) {
        alert("no files selected");
        return;
    }
    renderer.restartFromFiles(files);
})
const dicomZipSelect = document.getElementById("dicom_zip") as HTMLInputElement;
dicomZipSelect.addEventListener("change", async () => {
    const files = dicomZipSelect.files;
    if (!files) {
        alert("no files selected");
        return;
    }
    if (files.length !== 1) {
        alert("more than one file selected")
        return;
    }
    renderer.restartFromZip(files[0])
})

const sampleBenchmark: VolxelBenchmark = {
    "sharedSettings": [
        {
            "version": "v2",
            "transfer": {
                "densityMultiplier": 0.99,
                "transfer": {
                    "type": "color_stops",
                    "colors": [
                        {
                            "color": [
                                0.5686274509803921,
                                0.2549019607843137,
                                0.6745098039215687,
                                0.54
                            ],
                            "stop": 0
                        },
                        {
                            "color": [
                                0.9725490196078431,
                                0.8941176470588236,
                                0.3607843137254902,
                                1
                            ],
                            "stop": 0.17822873724342708
                        },
                        {
                            "color": [
                                0,
                                1,
                                1,
                                0.17
                            ],
                            "stop": 0.3985239852398524
                        }
                    ]
                },
                "histogramRange": [
                    0.05645751953125,
                    1
                ]
            },
            "lighting": {
                "useEnv": true,
                "showEnv": true,
                "envStrength": 1,
                "syncLightDir": false,
                "lightDir": [
                    -0.5773502691896258,
                    -0.5773502691896257,
                    -0.5773502691896257
                ]
            },
            "display": {
                "bounces": 3,
                "samples": 2000,
                "gamma": 2.2,
                "exposure": 5.5,
                "debugHits": false,
                "renderMode": "default"
            },
            "other": {
                "clipMax": [
                    0.6064378835126293,
                    1,
                    1
                ],
                "clipMin": [
                    0,
                    0,
                    0
                ],
                "cameraLookAt": [
                    0.0025690138263833135,
                    0.027589039598078468,
                    -0.04982115887377399
                ],
                "cameraPos": [
                    0.6547655718290891,
                    0.08942861381003304,
                    -0.12388057835783264
                ]
            }
        }
    ],
    "benchmarks": [
        {
            "renderMode": "default",
            "settings": 0
        },
        {
            "renderMode": "no_dda",
            "settings": 0
        },
        {
            "renderMode": "raymarch",
            "settings": 0
        }
    ]
}

console.log(sampleBenchmark)