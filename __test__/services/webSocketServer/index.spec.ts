import { describe, expect, it } from "@jest/globals";

import { Server, WebSocket } from "mock-socket";
import type { Server as HttpServer } from "node:http";
import { Realm } from "../../../src/models/realm.ts";
import { WebSocketServer } from "../../../src/services/webSocketServer/index.ts";
import { Errors, MessageType } from "../../../src/enums.ts";
import { wait } from "../../utils.ts";

type Destroyable<T> = T & { destroy?: () => Promise<void> };

const checkOpen = async (c: WebSocket): Promise<boolean> => {
	return new Promise((resolve) => {
		c.onmessage = (event: object & { data?: string }): void => {
			const message = JSON.parse(event.data as string);
			resolve(message.type === MessageType.OPEN);
		};
	});
};

const checkSequence = async (
	c: WebSocket,
	msgs: { type: MessageType; error?: Errors }[],
): Promise<boolean> => {
	return new Promise((resolve) => {
		const restMessages = [...msgs];

		const finish = (success = false): void => {
			resolve(success);
		};

		c.onmessage = (event: object & { data?: string }): void => {
			const [mes] = restMessages;

			if (!mes) {
				return finish();
			}

			restMessages.shift();

			const message = JSON.parse(event.data as string);
			if (message.type !== mes.type) {
				return finish();
			}

			const isOk = !mes.error || message.payload?.msg === mes.error;

			if (!isOk) {
				return finish();
			}

			if (restMessages.length === 0) {
				finish(true);
			}
		};
	});
};

const createTestServer = ({
	realm,
	config,
	url,
}: {
	realm: Realm;
	config: {
		path: string;
		key: string;
		concurrent_limit: number;
		allow_override_connection: boolean;
	};
	url: string;
}): Destroyable<WebSocketServer> => {
	const server = new Server(url) as Server & HttpServer;
	const webSocketServer: Destroyable<WebSocketServer> = new WebSocketServer({
		server,
		realm,
		config,
	});

	server.on(
		"connection",
		(
			socket: WebSocket & {
				on?: (eventName: string, callback: () => void) => void;
			},
		) => {
			const s = webSocketServer.socketServer;
			s.emit("connection", socket, { url: socket.url });

			socket.onclose = (): void => {
				const userId = socket.url
					.split("?")[1]
					?.split("&")
					.find((p) => p.startsWith("id"))
					?.split("=")[1];

				if (!userId) return;

				const client = realm.getClientById(userId);

				const clientSocket = client?.getSocket();

				if (!clientSocket) return;

				(clientSocket as unknown as WebSocket).listeners[
					"server::close"
				]?.forEach((s: () => void) => s());
			};

			socket.onmessage = (event: object & { data?: string }): void => {
				const userId = socket.url
					.split("?")[1]
					?.split("&")
					.find((p) => p.startsWith("id"))
					?.split("=")[1];

				if (!userId) return;

				const client = realm.getClientById(userId);

				const clientSocket = client?.getSocket();

				if (!clientSocket) return;

				(clientSocket as unknown as WebSocket).listeners[
					"server::message"
				]?.forEach((s: (data: object) => void) => s(event));
			};
		},
	);

	webSocketServer.destroy = async (): Promise<void> => {
		server.close();
	};

	return webSocketServer;
};

describe("WebSocketServer", () => {
	it("should return valid path", () => {
		const realm = new Realm();
		const config = {
			path: "/",
			key: "testKey",
			concurrent_limit: 1,
			allow_override_connection: false,
		};
		const config2 = { ...config, path: "path" };
		const server = new Server("path1") as Server & HttpServer;
		const server2 = new Server("path2") as Server & HttpServer;

		const webSocketServer = new WebSocketServer({ server, realm, config });

		expect(webSocketServer.path).toBe("/peerjs");

		const webSocketServer2 = new WebSocketServer({
			server: server2,
			realm,
			config: config2,
		});

		expect(webSocketServer2.path).toBe("path/peerjs");

		server.stop();
		server2.stop();
	});

	it(`should check client's params`, async () => {
		const realm = new Realm();
		const config = {
			path: "/",
			key: "testKey",
			concurrent_limit: 1,
			allow_override_connection: false,
		};
		const fakeURL = "ws://localhost:8080/peerjs";

		const getError = async (
			url: string,
			validError: Errors = Errors.INVALID_WS_PARAMETERS,
		): Promise<boolean> => {
			const webSocketServer = createTestServer({ url, realm, config });

			const ws = new WebSocket(url);

			const errorSent = await checkSequence(ws, [
				{ type: MessageType.ERROR, error: validError },
			]);

			ws.close();

			await webSocketServer.destroy?.();

			return errorSent;
		};

		expect(await getError(fakeURL)).toBe(true);
		expect(await getError(`${fakeURL}?key=${config.key}`)).toBe(true);
		expect(await getError(`${fakeURL}?key=${config.key}&id=1`)).toBe(true);
		expect(
			await getError(
				`${fakeURL}?key=notValidKey&id=userId&token=userToken`,
				Errors.INVALID_KEY,
			),
		).toBe(true);
	});

	it(`should check concurrent limit`, async () => {
		const realm = new Realm();
		const config = {
			path: "/",
			key: "testKey",
			concurrent_limit: 1,
			allow_override_connection: false,
		};
		const fakeURL = "ws://localhost:8080/peerjs";

		const createClient = (id: string): Destroyable<WebSocket> => {
			// id in the path ensures that all mock servers listen on different urls
			const url = `${fakeURL}${id}?key=${config.key}&id=${id}&token=${id}`;
			const webSocketServer = createTestServer({ url, realm, config });
			const ws: Destroyable<WebSocket> = new WebSocket(url);

			ws.destroy = async (): Promise<void> => {
				ws.close();

				await wait(10);

				webSocketServer.destroy?.();

				await wait(10);

				ws.destroy = undefined;
			};

			return ws;
		};

		const c1 = createClient("1");

		expect(await checkOpen(c1)).toBe(true);

		const c2 = createClient("2");

		expect(
			await checkSequence(c2, [
				{ type: MessageType.ERROR, error: Errors.CONNECTION_LIMIT_EXCEED },
			]),
		).toBe(true);

		await c1.destroy?.();
		await c2.destroy?.();

		await wait(10);

		expect(realm.getClientsIds().length).toBe(0);

		const c3 = createClient("3");

		expect(await checkOpen(c3)).toBe(true);

		await c3.destroy?.();
	});
});
