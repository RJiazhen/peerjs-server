import type { WebSocketServer, ServerOptions } from "ws";
import type { CorsOptions } from "cors";

export interface IConfig {
	readonly host: string;
	readonly port: number;
	readonly expire_timeout: number;
	readonly alive_timeout: number;
	readonly key: string;
	readonly path: string;
	readonly concurrent_limit: number;
	readonly allow_discovery: boolean;
	readonly allow_override_connection: boolean;
	readonly proxied: boolean | string;
	readonly cleanup_out_msgs: number;
	readonly ssl?: {
		key: string;
		cert: string;
	};
	readonly generateClientId?: () => string;
	readonly createWebSocketServer?: (options: ServerOptions) => WebSocketServer;
	readonly corsOptions: CorsOptions;
}

const defaultConfig: IConfig = {
	host: "::",
	port: 9000,
	expire_timeout: 5000,
	alive_timeout: 90000,
	key: "peerjs",
	path: "/my-peerjs-server",
	concurrent_limit: 5000,
	allow_discovery: false,
	allow_override_connection: false,
	proxied: false,
	cleanup_out_msgs: 1000,
	corsOptions: { origin: true },
};

export default defaultConfig;
