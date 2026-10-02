/**
 * Laya (and its ~280 MB onnxruntime) is NOT a normal dependency, so installing smart-router stays tiny.
 * `smart-router download` installs it into this folder on demand.
 */
export declare const LAYA_HOME: string;
/** Loads the Laya package from the normal module path or from LAYA_HOME. Throws if it is not installed. */
export declare function importLaya(): Promise<any>;
/** Installs the Laya package into LAYA_HOME using npm. */
export declare function installLaya(log: (msg: string) => void): Promise<void>;
