import "./index.css";

import ImportedWorker from "@volxel/3d-viewer/worker?worker"

import {registerVolxelComponents, Volxel3DDicomRenderer} from "@volxel/3d-viewer";

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
