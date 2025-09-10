import {ColorStop} from "./utils/data";

export enum TransferSettingsVersion {
    V1 = "v1"
}
export enum TransferSettingsTransferType {
    COLOR_STOPS = "color_stops",
    FULL = "full"
}
export type TransferSettings = {
    version: TransferSettingsVersion.V1;
    densityMultiplier: number;
    transfer: {
        type: TransferSettingsTransferType.COLOR_STOPS;
        colors: ColorStop[];
    } | {
        type: TransferSettingsTransferType.FULL;
        colors: [r: number, g: number, b: number, density: number][]
    }
    histogramRange: [min: number, max: number]
}

export function verifyTransferSettings(settings: TransferSettings): TransferSettings {
    if (settings.version !== TransferSettingsVersion.V1) throw new Error(`Transfer settings version ${settings.version} unsupported by current Volxel Viewer version.`)
    if (
        typeof settings.densityMultiplier !== "number" ||
        !Array.isArray(settings.histogramRange) ||
        settings.histogramRange.length !== 2 ||
        settings.histogramRange.some(it => typeof it !== "number") ||
        (settings.transfer.type !== TransferSettingsTransferType.COLOR_STOPS && settings.transfer.type !== TransferSettingsTransferType.FULL) ||
        (settings.transfer.type === TransferSettingsTransferType.FULL && settings.transfer.colors.flat().some(it => typeof it !== "number")) ||
        (settings.transfer.type === TransferSettingsTransferType.COLOR_STOPS && settings.transfer.colors.some(({stop, color}) => typeof stop !== "number" || color.some(it => typeof it !== "number")))
    ) {
        throw new Error("Malformed Transfer Settings detected.")
    }
    return settings;
}

const download = document.createElement("a");
export function saveTransferSettings(settings: TransferSettings) {
    verifyTransferSettings(settings);
    const blob = new Blob([JSON.stringify(settings)])
    const url = URL.createObjectURL(blob);
    download.href = url;
    download.download = "transfer.json"
    download.click()
    URL.revokeObjectURL(url);
}
export async function loadTransferSettings(from: File | string | Blob | URL) {
    let text: string
    if (from instanceof Blob) {
        text = await from.text()
    } else if (from instanceof File) {
        text = await from.text()
    } else if (from instanceof URL) {
        const res = await fetch(from);
        text = await res.text()
    } else text = from;
    const parsed = JSON.parse(text);
    return verifyTransferSettings(parsed);
}