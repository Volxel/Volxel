import {ColorStop} from "./utils/data";
import {Vector3} from "math.gl";

export enum SettingsVersion {
    V1 = "v1"
}

export enum TransferSettingsTransferType {
    COLOR_STOPS = "color_stops",
    FULL = "full"
}

export type TransferSettings = {
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

export type DisplaySettings = {
    samples: number,
    bounces: number,
    gamma: number,
    exposure: number,
    debugHits: boolean
}
export type LightingSettings = {
    useEnv: boolean,
    showEnv: boolean,
    envStrength: number,
    syncLightDir: boolean,
    lightDir: [number, number, number]
}

export type ViewerSettings = {
    densityMultiplier: number,
    maxSamples: number,
    debugHits: boolean,
    volumeClipMin: Vector3,
    volumeClipMax: Vector3,
    showEnvironment: boolean,
    useEnv: boolean,
    lightDir: Vector3,
    syncLightDir: boolean,
    bounces: number,
    gamma: number,
    exposure: number,
    sampleRange: [number, number]
}
export type SettingsExport = {
    version: SettingsVersion.V1;
    transfer: TransferSettings,
    display: DisplaySettings,
    lighting: LightingSettings,
    other: {
        cameraPos: [number, number, number],
        cameraLookAt: [number, number, number],
        clipMin: [number, number, number],
        clipMax: [number, number, number]
    }
}

export function verifyTransferSettings(settings: TransferSettings): TransferSettings {
    if (
        typeof settings.densityMultiplier !== "number" ||
        !Array.isArray(settings.histogramRange) ||
        settings.histogramRange.length !== 2 ||
        settings.histogramRange.some(it => typeof it !== "number") ||
        (settings.transfer.type !== TransferSettingsTransferType.COLOR_STOPS && settings.transfer.type !== TransferSettingsTransferType.FULL) ||
        (settings.transfer.type === TransferSettingsTransferType.FULL && settings.transfer.colors.flat().some(it => typeof it !== "number")) ||
        (settings.transfer.type === TransferSettingsTransferType.COLOR_STOPS && settings.transfer.colors.some(
            ({
                 stop,
                 color
             }) => typeof stop !== "number" || color.some(it => typeof it !== "number")))
    ) {
        throw new Error("Malformed Transfer Settings detected.")
    }
    return settings;
}

export function verifyDisplaySettings(settings: DisplaySettings) {
    if (typeof settings.samples !== "number" ||
        typeof settings.bounces !== "number" ||
        typeof settings.gamma !== "number" ||
        typeof settings.exposure !== "number" ||
        typeof settings.debugHits !== "boolean") {
        throw new Error("Malformed Display Settings detected.")
    }
}

export function verifyVector(vector: any) {
    if (typeof vector !== "object" || !Array.isArray(vector) || vector.length !== 3 || vector.some(entry => typeof entry !== "number")) {
        throw new Error("Malformed Vector in Settings detected.");
    }
}

export function verifyLightingSettings(settings: LightingSettings) {
    if (typeof settings.envStrength !== "number" || typeof settings.showEnv !== "boolean" || typeof settings.useEnv !== "boolean" || typeof settings.syncLightDir !== "boolean") {
        throw new Error("Malformed Lighting Settings detected.");
    }
    verifyVector(settings.lightDir);
}

export function verifySettings(settings: SettingsExport) {
    if (settings.version !== SettingsVersion.V1) {
        throw new Error(`Unsupported Settings Format Version: ${settings.version}`);
    }
    verifyTransferSettings(settings.transfer);
    verifyDisplaySettings(settings.display);
    verifyLightingSettings(settings.lighting);
    verifyVector(settings.other.cameraLookAt);
    verifyVector(settings.other.cameraPos);
    verifyVector(settings.other.clipMax);
    verifyVector(settings.other.clipMin);
    return settings;
}

const download = document.createElement("a");

export function saveSettings(settings: SettingsExport) {
    verifySettings(settings);
    const blob = new Blob([JSON.stringify(settings)])
    const url = URL.createObjectURL(blob);
    download.href = url;
    download.download = "settings.json"
    download.click()
    URL.revokeObjectURL(url);
}

export async function loadSettings(from: File | string | Blob | URL) {
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
    return verifySettings(parsed);
}