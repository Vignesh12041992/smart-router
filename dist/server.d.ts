import type { Server } from "http";
import type { IntelligentRouter } from "./services/router.js";
export declare function createApp(router: IntelligentRouter): import("express-serve-static-core").Express;
export declare function startServer(router: IntelligentRouter, port: number, host?: string): Promise<Server>;
