import { server } from "../mock/server.js";
import { createGp } from "../src/index.js";

/** Boots the mock on an ephemeral port so tests never collide with a dev server. */
export async function startMock() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/ucp`,
    gp: createGp({
      environment: "mock",
      baseUrl: `http://127.0.0.1:${port}/ucp`,
      appId: "test_app",
      appKey: "test_key",
    }),
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
