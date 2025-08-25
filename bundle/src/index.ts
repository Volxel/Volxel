import DicomWorker from "@volxel/3d-viewer/worker?worker&inline"
import {registerVolxelComponents} from "@volxel/3d-viewer";

registerVolxelComponents(() => new DicomWorker())