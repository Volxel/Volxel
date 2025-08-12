import "./index.css";

import {Volxel3DDicomRenderer, dicomBasePaths, loadGrid, loadGridFromFiles} from "@volxel/3d-viewer";

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
    await renderer.restartRendering(async () => {
        const grid = await loadGrid(Number.parseInt(modelSelect.value.replace("dicom_", "")))
        renderer.setupFromGrid(grid);
    })
});

const dicomFileSelect = document.getElementById("dicom") as HTMLInputElement;
dicomFileSelect.addEventListener("change", async () => {
    await renderer.restartRendering(async () => {
        const files = dicomFileSelect.files;
        if (!files) {
            alert("no files selected");
            return;
        }

        const grid = await loadGridFromFiles(files);
        renderer.setupFromGrid(grid);
    })
})