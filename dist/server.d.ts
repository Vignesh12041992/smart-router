import type { Server } from "http";
import type { IntelligentRouter } from "./services/router.js";
import { type ProxyOptions } from "./proxy.js";
export declare function createApp(router: IntelligentRouter, proxy?: ProxyOptions): import("express-serve-static-core").Express;
export declare function startServer(router: IntelligentRouter, port: number, host?: string, proxy?: ProxyOptions): Promise<Server>;
