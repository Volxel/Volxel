import "./index.css";

import ImportedWorker from "@volxel/3d-viewer/worker?worker"

import {dicomBasePaths, gridUrls, registerVolxelComponents, Volxel3DDicomRenderer} from "@volxel/3d-viewer";

registerVolxelComponents(() => new ImportedWorker())

const renderer = document.getElementById("renderer") as Volxel3DDicomRenderer;

const modelSelect = document.getElementById("density") as HTMLSelectElement;
for (let i = 0; i < dicomBasePaths.length; i++) {
    const basePath = dicomBasePaths[i];
    const option = document.createElement("option");
    option.value = `dicom_${i}`;
    option.innerHTML = basePath.url;
    modelSelect.appendChild(option);
}
modelSelect.value = "";
modelSelect.addEventListener("change", async () => {
    await renderer.restartFromURLs(gridUrls(Number.parseInt(modelSelect.value.replace("dicom_", ""))))
});

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